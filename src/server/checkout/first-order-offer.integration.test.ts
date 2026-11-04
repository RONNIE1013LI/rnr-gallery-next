import { createReturningCustomerVoucher } from "./returning-customer-voucher";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql, SQL, eq } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { contentEntries, checkoutSessions, orderItems, orderAddresses, orders, user, productionJobs, productionJobItems } from "@/server/db/schema";
import { repriceCart } from "@/domain/checkout/reprice-cart";
import { normalizeAddress } from "@/domain/address/schema";
import { createDrizzleOrderRepository, buildWebProductionJobSnapshot } from "@/server/orders/drizzle-order-repository";
import { createDrizzleInvoiceRepository } from "@/server/invoices/drizzle-invoice-repository";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertFirstOrderOfferAvailable, isFirstOrderOfferEligible, isReturningOfferEligible, resolveCustomerOffer, InvalidReturningVoucherError } from "./first-order-offer";

// Run explicitly with RNR_LOCAL_POSTGRES_TESTS=1.
// This fixture owns its ephemeral loopback-only database; it never reads application credentials or runs migrations.
const container = `rnr-first-order-test-${randomUUID().slice(0,8)}`;
let pool: pg.Pool;
let database: ReturnType<typeof drizzle>;
let started = false;
const describeLocalPostgres = process.env.RNR_LOCAL_POSTGRES_TESTS === "1" ? describe : describe.skip;

describeLocalPostgres("repeatable promotion and atomic campaign checks",()=>{
beforeAll(async () => {
  execFileSync("docker", ["run", "--rm", "-d", "--name", container, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-e", "POSTGRES_DB=rnr_first_order_test", "-p", "127.0.0.1::5432", "postgres:17-alpine"], {stdio:"pipe"});
  started = true;
  const endpoint=execFileSync("docker",["port",container,"5432/tcp"],{encoding:"utf8"}).trim();
  if(!/^127\.0\.0\.1:\d+$/.test(endpoint)) throw Error("Test database must be loopback-only");
  pool=new pg.Pool({connectionString:`postgresql://postgres@${endpoint}/rnr_first_order_test`, max:4});
  for(let attempt=0;attempt<50;attempt++){try{await pool.query("select 1");break;}catch(error){if(attempt===49)throw error;await new Promise(resolve=>setTimeout(resolve,100));}}
  // Fixture columns/defaults come from the owning schema. No migration files are generated or executed.
  const dialect = new PgDialect();
  for (const table of [contentEntries, user, orders, checkoutSessions, orderItems, orderAddresses, productionJobs, productionJobItems]) {
    const config = getTableConfig(table);
    const columns = config.columns.map(column => {
      let value = "";
      if (column.default instanceof SQL) value = dialect.sqlToQuery(column.default).sql;
      else if (column.default !== undefined) {
        value = typeof column.default === "number" || typeof column.default === "boolean"
          ? String(column.default)
          : "'" + (typeof column.default === "string" ? column.default : JSON.stringify(column.default)).replaceAll("'", "''") + "'";
      }
      return `"${column.name}" ${column.getSQLType()}${value ? ` default ${value}` : ""}`;
    });
    await pool.query(`create table "${config.name}" (${columns.join(",")})`);
  }
  database=drizzle(pool);
}, 20_000);
afterAll(async()=>{await pool?.end();if(started)execFileSync("docker",["rm","-f",container],{stdio:"pipe"});});
beforeEach(async()=>{await pool.query('truncate content_entries,orders,"user",checkout_sessions,order_items,order_addresses,production_jobs,production_job_items');await pool.query('insert into "user" (id,email) values ($1,$2)',["customer-1","New@Example.test"]);});

async function history(status:string,promotion=false,customerId:string|null="customer-1") {
  await pool.query("insert into orders (id,customer_id,customer_email,payment_status,pricing_snapshot) values($1,$2,$3,$4,$5)",[randomUUID(),customerId,"new@example.test",status,JSON.stringify(promotion?{promotion:{key:"first-order-20-v1",percentage:20}}:{})]);
}

  async function discountedOrderInput(returningCustomerDiscount = false, customerId: string | null = "customer-1") {
    const now = new Date();
    const cart = repriceCart({version:1, items:[{
      clientItemId:randomUUID(), productKey:"photo-print-canvas", sizeKey:"a4", orientation:"landscape",
      peoplePets:0, photoSubmissionMethod:"later", designText:"Test artwork", notes:"", neededDate:"2027-08-10",
      urgentServiceConfirmed:false, quantity:2, uploadReferences:[],
    }]}, {now,firstOrderDiscount:!returningCustomerDiscount,returningCustomerDiscount});
    const address = normalizeAddress({country:"NZ",fullName:"Test Customer",building:"",street:"1 Test Street",suburb:"Auckland Central",region:"Auckland",postcode:"1010",phone:"0211234567",email:"new@example.test"});
    const [session] = await database.insert(checkoutSessions).values({
      tokenDigest:randomUUID(), customerId, expiresAt:new Date(now.getTime()+86_400_000),
      cartDigest:cart.cartDigest, cartSnapshot:cart, billingAddress:address, deliveryAddress:address, deliveryMethod:"pickup",
    }).returning();
    return {sessionId:session.id,expectedCustomerId:customerId,expectedVersion:session.version,
      expectedCartDigest:cart.cartDigest,cart,billingAddress:address,deliveryAddress:address,deliveryMethod:"pickup" as const,
      shipping:{kind:"pickup" as const},idempotencyKey:randomUUID(),orderNumber:`RNR-TEST-${randomUUID()}`,now};
  }

  it("persists a discounted order and seeds its invoice at the same net amount without a second discount",async()=>{
    const input = await discountedOrderInput();
    const order = await createDrizzleOrderRepository(database).createAtomicOrder(input);
    const [item] = await database.select().from(orderItems).where(eq(orderItems.orderId,order.id));
    expect(order.totalInclGstCents).toBe(11960);
    expect(item.unitTotalInclGstCents).toBe(5980);
    const snapshot = buildWebProductionJobSnapshot({order,cart:input.cart,billingAddress:input.billingAddress,
      deliveryAddress:input.deliveryAddress,deliveryMethod:"pickup",orderItemIds:[item.id],paymentStatus:"paid",now:input.now})!;
    const [job] = await database.insert(productionJobs).values({...snapshot.job,source:"web",orderId:order.id,webOrderNumber:order.orderNumber}).returning();
    const seed = await createDrizzleInvoiceRepository(database).getSeed(job.id);
    expect(seed?.items[0].rateInclGstCents).toBe(5980);
    expect(seed?.items[0].quantityMilli).toBe(2000);
    expect(seed?.totals).toMatchObject({grossCents:11960,discountCents:0,totalInclGstCents:11960});
    expect(seed!.totals!.subtotalExGstCents + seed!.totals!.gstCents).toBe(order.totalInclGstCents);
    const retried = await createDrizzleOrderRepository(database).createAtomicOrder(input);
    expect(retried.id).toBe(order.id);
  });

  it("allows guest promotional orders and rejects stale guest quotes when disabled", async () => {
    const repository = createDrizzleOrderRepository(database);
    const guest = await discountedOrderInput(false, null);
    await expect(repository.createAtomicOrder(guest)).resolves.toMatchObject({ totalInclGstCents: 11960, customerId: null });
    const staleGuest = await discountedOrderInput(false, null);
    await setPromotion("disabled");
    await expect(repository.createAtomicOrder(staleGuest)).rejects.toThrow("This promotion has ended");
    expect(await repository.createAtomicOrder(guest)).toMatchObject({ totalInclGstCents: 11960 });
  });

  async function setPromotion(value: "enabled" | "disabled") {
    await pool.query("delete from content_entries where key = 'promotions.thank_you.enabled'");
    await database.insert(contentEntries).values({key:"promotions.thank_you.enabled",groupName:"Promotions",label:"Anniversary promotion",draftValue:value,publishedValue:value});
  }

  it.each([false, true])("rejects a stale promotional quote after disabling (returning=%s)", async (returning) => {
    const input = await discountedOrderInput(returning);
    await setPromotion("disabled");
    expect(await isFirstOrderOfferEligible(database, "customer-1")).toBe(false);
    expect(await isReturningOfferEligible(database, "customer-1")).toBe(false);
    await expect(createDrizzleOrderRepository(database).createAtomicOrder(input))
      .rejects.toThrow("This promotion has ended");
    expect(Number((await pool.query("select count(*) from orders")).rows[0].count)).toBe(0);
  });

  it.each([false, true])("preserves existing submitted order retry and history through disabling/re-enabling (returning=%s)", async (returning) => {
    const input = await discountedOrderInput(returning);
    const repository = createDrizzleOrderRepository(database);
    const order = await repository.createAtomicOrder(input);
    const [stored] = await database.select({pricingSnapshot:orders.pricingSnapshot}).from(orders).where(eq(orders.id,order.id));
    await setPromotion("disabled");
    expect(await repository.createAtomicOrder(input)).toMatchObject({id:order.id,totalInclGstCents:order.totalInclGstCents});
    const [retried] = await database.select({pricingSnapshot:orders.pricingSnapshot}).from(orders).where(eq(orders.id,order.id));
    expect(retried.pricingSnapshot).toEqual(stored.pricingSnapshot);
    await setPromotion("enabled");
    expect(await isFirstOrderOfferEligible(database, "customer-1")).toBe(true);
    expect(await isReturningOfferEligible(database, "customer-1")).toBe(!returning);
    const next = repository.createAtomicOrder(await discountedOrderInput(returning));
    if (returning) await expect(next).rejects.toThrow("already been reserved or used");
    else await expect(next).resolves.toMatchObject({ totalInclGstCents: order.totalInclGstCents });
  });

  it("permits discounted orders across multiple checkout sessions",async()=>{
    const inputs = await Promise.all([discountedOrderInput(),discountedOrderInput()]);
    const repository = createDrizzleOrderRepository(database);
    const results = await Promise.allSettled(inputs.map(input=>repository.createAtomicOrder(input)));
    expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(2);
    expect(results.filter(result=>result.status==="rejected")).toHaveLength(0);
    expect(Number((await pool.query("select count(*) from orders")).rows[0].count)).toBe(2);
  });

  it("grants every promotional order including guests",async()=>{
    expect(await isFirstOrderOfferEligible(database,null)).toBe(true);
    expect(await isFirstOrderOfferEligible(database,"missing")).toBe(true);
    expect(await isFirstOrderOfferEligible(database,"customer-1")).toBe(true);
  });
  it.each(["paid","refunded","awaiting_payment","processing","failed","cancelled"])("permits another promotional order after %s history",async(status)=>{
    await history(status);
    expect(await isFirstOrderOfferEligible(database,"customer-1")).toBe(true);
  });
  it("does not restrict base promotion based on guest or old-account email history",async()=>{
    await history("paid",false,null);
    expect(await isFirstOrderOfferEligible(database,"customer-1")).toBe(true);
  });
  it.each(["awaiting_payment","processing","failed","cancelled"])("permits further promotional orders after %s",async(status)=>{
    await history(status,true);
    await expect(database.transaction(tx=>assertFirstOrderOfferAvailable(tx,"customer-1",false))).resolves.toBeUndefined();
    await expect(database.transaction(tx=>assertFirstOrderOfferAvailable(tx,"customer-1",true))).resolves.toBeUndefined();
  });
  it.each(["paid","refunded"])("permits further discounted orders after %s",async(status)=>{
    await history(status,true);
    await expect(database.transaction(tx=>assertFirstOrderOfferAvailable(tx,"customer-1",false))).resolves.toBeUndefined();
    await expect(database.transaction(tx=>assertFirstOrderOfferAvailable(tx,"customer-1",true))).resolves.toBeUndefined();
  });
  it("permits simultaneous promotional orders for the same account",async()=>{
    const attempt=()=>database.transaction(async tx=>{
      await assertFirstOrderOfferAvailable(tx,"customer-1",true);
      await tx.execute(sql`insert into orders (id,customer_id,customer_email,payment_status,pricing_snapshot) values(${randomUUID()},'customer-1','new@example.test','awaiting_payment','{"promotion":{"key":"first-order-20-v1","percentage":20}}'::jsonb)`);
    });
    const results=await Promise.allSettled([attempt(),attempt()]);
    expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(2);
    expect(results.filter(result=>result.status==="rejected")).toHaveLength(0);
    expect(Number((await pool.query("select count(*) from orders")).rows[0].count)).toBe(2);
  });
  it("validates an account-bound code without requiring old web history",async()=>{
    const secret="test-only-voucher-secret-0123456789abcdef";
    const code=createReturningCustomerVoucher("customer-1",secret);
    expect(await resolveCustomerOffer(database,"customer-1",code,secret)).toEqual({firstOrderDiscount:false,returningCustomerDiscount:true});
    await expect(resolveCustomerOffer(database,null,code,secret)).rejects.toBeInstanceOf(InvalidReturningVoucherError);
    await expect(resolveCustomerOffer(database,"customer-1",code+"X",secret)).rejects.toBeInstanceOf(InvalidReturningVoucherError);
    await expect(resolveCustomerOffer(database,"customer-1",42,secret)).rejects.toBeInstanceOf(InvalidReturningVoucherError);
  });
  it.each(["awaiting_payment","processing","failed","cancelled","paid","refunded"])("blocks the returning voucher after %s while keeping base 20% available",async(status)=>{
    await pool.query("insert into orders (id,customer_id,customer_email,payment_status,pricing_snapshot) values($1,$2,$3,$4,$5)",[randomUUID(),"customer-1","new@example.test",status,JSON.stringify({promotion:{key:"returning-customer-36-v1"}})]);
    expect(await isReturningOfferEligible(database,"customer-1")).toBe(false);
    expect(await isFirstOrderOfferEligible(database,"customer-1")).toBe(true);
    await expect(database.transaction(tx=>assertFirstOrderOfferAvailable(tx,"customer-1",false,true))).rejects.toThrow("already been reserved or used");
  });
  it("permits only one concurrent returning-voucher order and preserves invoice pricing",async()=>{
    await history("paid");
    const inputs=await Promise.all([discountedOrderInput(true),discountedOrderInput(true)]);
    const repository=createDrizzleOrderRepository(database);
    const results=await Promise.allSettled(inputs.map(input=>repository.createAtomicOrder(input)));
    expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    expect(results.filter(result=>result.status==="rejected")).toHaveLength(1);
    const successful=results.find(result=>result.status==="fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof repository.createAtomicOrder>>>;
    expect(successful.value.totalInclGstCents).toBe(9568);
    const winningIndex=results[0].status==="fulfilled"?0:1;
    const input=inputs[winningIndex];
    const [item]=await database.select().from(orderItems).where(eq(orderItems.orderId,successful.value.id));
    const snapshot=buildWebProductionJobSnapshot({order:successful.value,cart:input.cart,billingAddress:input.billingAddress,
      deliveryAddress:input.deliveryAddress,deliveryMethod:"pickup",orderItemIds:[item.id],paymentStatus:"paid",now:input.now})!;
    const [job]=await database.insert(productionJobs).values({...snapshot.job,source:"web",orderId:successful.value.id,webOrderNumber:successful.value.orderNumber}).returning();
    const seed=await createDrizzleInvoiceRepository(database).getSeed(job.id);
    expect(seed?.totals?.totalInclGstCents).toBe(9568);
    expect(seed?.items[0].rateInclGstCents).toBe(4784);

    expect(await isReturningOfferEligible(database,"customer-1")).toBe(false);
    expect(await repository.createAtomicOrder(input)).toMatchObject({id:successful.value.id,totalInclGstCents:9568});
  });

  it("rechecks campaign state after waiting for a returning-voucher lock", async () => {
    const blocker = await pool.connect();
    let outcome: Promise<{ value: unknown; error: unknown }> | undefined;
    try {
      await blocker.query("begin");
      await blocker.query("select pg_advisory_xact_lock(hashtextextended($1,0))", ["returning-voucher-customer:customer-1"]);
      const repository = createDrizzleOrderRepository(database);
      outcome = repository.createAtomicOrder(await discountedOrderInput(true))
        .then(value => ({ value, error: null }), error => ({ value: null, error }));
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const locks = await pool.query("select exists(select 1 from pg_locks where locktype='advisory' and not granted) as waiting");
        if (locks.rows[0]?.waiting) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await setPromotion("disabled");
    } finally {
      await blocker.query("rollback"); blocker.release();
    }
    const result = await outcome!;
    expect(result.error).toMatchObject({ message: "This promotion has ended. Refresh your checkout to see current pricing." });
    expect(Number((await pool.query("select count(*) from orders")).rows[0].count)).toBe(0);
  });

});
