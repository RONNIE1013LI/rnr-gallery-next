import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeAddress } from "@/domain/address/schema";
import { repriceCart } from "@/domain/checkout/reprice-cart";
import {
  checkoutSessions,
  checkoutUploads,
  orderAddresses,
  orderItems,
  orders,
  paymentAttempts,
  shippingQuotes,
  user,
} from "@/server/db/schema";
import { createDrizzleCheckoutRepository } from "@/server/checkout/drizzle-checkout-repository";
import {
  createDrizzleOrderRepository,
} from "./drizzle-order-repository";
import { createDrizzleOrderQueryRepository } from "./drizzle-order-query-repository";
import { createOrderQueryService } from "./order-query-service";
import { createOrderService } from "./order-service";
import {
  AtomicOrderStateError,
  OrderConflictError,
  OrderNumberCollisionError,
  UnclaimableUploadError,
} from "./order-repository";
import { createShippingService } from "@/server/shipping/shipping-service";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");

const pool = new Pool({ connectionString: databaseUrl });
const database = drizzle(pool);
const checkoutRepository = createDrizzleCheckoutRepository(database);
const repository = createDrizzleOrderRepository(database);
const queryRepository = createDrizzleOrderQueryRepository(database);
const suffix = randomUUID();
const sessionIds: string[] = [];
const customerIds: string[] = [];
const now = new Date("2026-08-02T12:00:00.000Z");
const address = normalizeAddress({
  country: "NZ", fullName: "Aroha Ngata", building: "",
  street: "12 Queen Street", suburb: "Auckland Central", region: "Auckland",
  postcode: "1010", phone: "021 123 4567", email: "aroha@example.test",
});

function cart(uploadReferences: string[] = [], neededDate = "2026-08-10") {
  return repriceCart({
    version: 1,
    items: [{
      clientItemId: randomUUID(),
      productKey: "photo-print-canvas", sizeKey: "a4", orientation: "landscape",
      peoplePets: 0,
      photoSubmissionMethod: uploadReferences.length ? "upload" : "later",
      designText: "Family", notes: "", neededDate,
      urgentServiceConfirmed: false, quantity: 1, uploadReferences,
    }],
  }, { now });
}

function bannerCart() {
  return repriceCart({
    version: 1,
    items: [{
      clientItemId: randomUUID(),
      productKey: "roll-up-banner", sizeKey: "standard",
      peoplePets: 0, photoSubmissionMethod: "later",
      designText: "Celebration", notes: "", neededDate: "2026-08-10",
      urgentServiceConfirmed: false, quantity: 1, uploadReferences: [],
    }],
  }, { now });
}

async function checkout({
  customerId = null,
  method = "pickup" as "pickup" | "post",
  snapshot = cart(),
}: {
  customerId?: string | null;
  method?: "pickup" | "post";
  snapshot?: ReturnType<typeof cart>;
} = {}) {
  const session = await checkoutRepository.createSession({
    tokenDigest: `order-${randomUUID()}-${suffix}`,
    customerId,
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
  });
  sessionIds.push(session.id);
  const state = await checkoutRepository.saveCheckoutState(session.id, {
    cartDigest: snapshot.cartDigest,
    cartSnapshot: snapshot,
    billingAddress: address,
    deliveryAddress: address,
    deliveryMethod: method,
  });
  return state!;
}

function pickupInput(
  state: Awaited<ReturnType<typeof checkout>>,
  overrides: Record<string, unknown> = {},
) {
  return {
    sessionId: state.id,
    expectedCustomerId: state.customerId,
    expectedVersion: state.version,
    expectedCartDigest: state.cartDigest!,
    cart: state.cartSnapshot!,
    billingAddress: state.billingAddress!,
    deliveryAddress: state.deliveryAddress!,
    deliveryMethod: state.deliveryMethod!,
    shipping: { kind: "pickup" as const },
    idempotencyKey: randomUUID(),
    orderNumber: `RNR-2026-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`,
    now,
    ...overrides,
  };
}

function postInput(state: Awaited<ReturnType<typeof checkout>>) {
  return {
    ...pickupInput(state),
    shipping: {
      kind: "post" as const,
      requestDigest: "a".repeat(64),
      quote: {
        provider: "local-test" as const,
        serviceCode: "post",
        serviceName: "Fresh Test Post",
        amountExGstCents: 2_000,
        gstCents: 300,
        amountInclGstCents: 2_300,
        currency: "NZD" as const,
        providerReference: `fresh-${randomUUID()}`,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        rawResponseHash: "b".repeat(64),
        isTest: true,
      },
    },
  };
}

async function databaseNow(): Promise<Date> {
  const result = await pool.query<{ now: Date }>("select clock_timestamp() as now");
  return new Date(result.rows[0].now);
}

async function lockSession(sessionId: string) {
  const client = await pool.connect();
  await client.query("begin");
  await client.query(
    "select id from checkout_sessions where id = $1 for update",
    [sessionId],
  );
  return {
    async releaseAfter(milliseconds: number) {
      try {
        await client.query("select pg_sleep($1)", [milliseconds / 1_000]);
        await client.query("commit");
      } finally {
        client.release();
      }
    },
  };
}

describe("Drizzle atomic order repository", () => {
  beforeAll(async () => {
    const customerId = `order-customer-${suffix}`;
    customerIds.push(customerId);
    await database.insert(user).values({
      id: customerId,
      name: "Order Customer",
      email: `order-${suffix}@example.test`,
    });
  });

  afterAll(async () => {
    if (sessionIds.length) {
      await database.delete(checkoutUploads)
        .where(inArray(checkoutUploads.checkoutSessionId, sessionIds));
      const ownedOrders = await database.select({ id: orders.id }).from(orders)
        .where(inArray(orders.checkoutSessionId, sessionIds));
      if (ownedOrders.length) {
        await database.delete(paymentAttempts)
          .where(inArray(paymentAttempts.orderId, ownedOrders.map(({ id }) => id)));
      }
      await database.delete(orders).where(inArray(orders.checkoutSessionId, sessionIds));
      await database.update(checkoutSessions)
        .set({ selectedShippingQuoteId: null })
        .where(inArray(checkoutSessions.id, sessionIds));
      await database.delete(shippingQuotes)
        .where(inArray(shippingQuotes.checkoutSessionId, sessionIds));
      await database.delete(checkoutSessions).where(inArray(checkoutSessions.id, sessionIds));
    }
    if (customerIds.length) {
      await database.delete(user).where(inArray(user.id, customerIds));
    }
    await pool.end();
  });

  it("creates immutable Pickup snapshots, two addresses and consumes a guest checkout", async () => {
    const state = await checkout();
    const input = pickupInput(state);
    const order = await repository.createAtomicOrder(input);

    expect(order).toMatchObject({
      customerId: null,
      customerEmail: "aroha@example.test",
      shippingProvider: null,
      shippingServiceCode: "pickup",
      shippingServiceName: "Pickup",
      shippingProviderReference: null,
      shippingIsTest: false,
      shippingRequestDigest: null,
      shippingTotalInclGstCents: 0,
      totalInclGstCents: 7_475,
    });
    expect(await database.select().from(orderAddresses)
      .where(eq(orderAddresses.orderId, order.id))).toHaveLength(2);
    expect((await repository.getCheckoutState(state.id))?.completedAt).toEqual(now);
    expect(await repository.findSessionByTokenDigest(state.tokenDigest, now))
      .toMatchObject({ id: state.id, customerId: null });

    await expect(repository.createAtomicOrder(input)).resolves.toMatchObject({ id: order.id });
    await expect(repository.createAtomicOrder({
      ...input, idempotencyKey: randomUUID(),
    })).rejects.toBeInstanceOf(OrderConflictError);
    await expect(checkoutRepository.saveCheckoutState(state.id, {
      cartDigest: state.cartDigest!, cartSnapshot: state.cartSnapshot!,
      billingAddress: address, deliveryAddress: address, deliveryMethod: "pickup",
    })).resolves.toBeNull();
    await expect(checkoutRepository.clearSelectedShippingQuote(state.id, state.version))
      .resolves.toBe(false);
    await expect(checkoutRepository.persistAndSelectShippingQuote({
      sessionId: state.id,
      expectedVersion: state.version,
      requestDigest: "d".repeat(64),
      quote: {
        provider: "local-test", serviceCode: "post", serviceName: "Too late",
        amountExGstCents: 2_000, gstCents: 300, amountInclGstCents: 2_300,
        currency: "NZD", providerReference: `completed-${randomUUID()}`,
        expiresAt: new Date("2026-08-02T12:15:00.000Z"),
        rawResponseHash: "e".repeat(64), isTest: true,
      },
    })).resolves.toBeNull();
    expect(await database.select().from(shippingQuotes)
      .where(eq(shippingQuotes.checkoutSessionId, state.id))).toHaveLength(0);
  });

  it("creates an order from a JSON-round-tripped orientation-none banner snapshot", async () => {
    const canonical = bannerCart();
    const state = await checkout({ snapshot: canonical });

    expect(state.cartSnapshot?.items[0]).not.toHaveProperty("orientation");
    await expect(repository.createAtomicOrder({
      ...pickupInput(state),
      cart: canonical,
    })).resolves.toMatchObject({ totalInclGstCents: 26_450 });
  });

  it("snapshots a fresh Post quote and preserves the signed-in owner", async () => {
    const state = await checkout({ customerId: customerIds[0], method: "post" });
    const input = postInput(state);
    const order = await repository.createAtomicOrder(input);

    expect(order).toMatchObject({
      customerId: customerIds[0],
      shippingProvider: "local-test",
      shippingServiceCode: "post",
      shippingServiceName: "Fresh Test Post",
      shippingProviderReference: input.shipping.quote.providerReference,
      shippingIsTest: true,
      shippingRequestDigest: "a".repeat(64),
      shippingTotalInclGstCents: 2_300,
      totalInclGstCents: 9_775,
    });
  });

  it("rejects an expired Post quote without persisting a quote or order", async () => {
    const state = await checkout({ method: "post" });
    const input = postInput(state);
    await expect(repository.createAtomicOrder({
      ...input,
      shipping: {
        ...input.shipping,
        quote: {
          ...input.shipping.quote,
          expiresAt: new Date("2000-01-01T00:00:00.000Z"),
        },
      },
    })).rejects.toBeInstanceOf(AtomicOrderStateError);
    expect(await repository.findBySession(state.id)).toBeNull();
    expect(await database.select().from(shippingQuotes)
      .where(eq(shippingQuotes.checkoutSessionId, state.id))).toHaveLength(0);
  });

  it("rejects a checkout session that expires while waiting for its row lock", async () => {
    const state = await checkout();
    const beforeLock = await databaseNow();
    const expiresAt = new Date(beforeLock.getTime() + 400);
    await database.update(checkoutSessions).set({ expiresAt })
      .where(eq(checkoutSessions.id, state.id));
    const locker = await lockSession(state.id);
    const rejection = expect(repository.createAtomicOrder({
      ...pickupInput(state),
      now: beforeLock,
    })).rejects.toBeInstanceOf(AtomicOrderStateError);

    await locker.releaseAfter(700);
    await rejection;
    expect(await repository.findBySession(state.id)).toBeNull();
  });

  it("rejects a Post quote that expires while waiting for its checkout lock", async () => {
    const state = await checkout({ method: "post" });
    const beforeLock = await databaseNow();
    const input = postInput(state);
    const locker = await lockSession(state.id);
    const rejection = expect(repository.createAtomicOrder({
      ...input,
      now: beforeLock,
      shipping: {
        ...input.shipping,
        quote: {
          ...input.shipping.quote,
          expiresAt: new Date(beforeLock.getTime() + 400),
        },
      },
    })).rejects.toBeInstanceOf(AtomicOrderStateError);

    await locker.releaseAfter(700);
    await rejection;
    expect(await repository.findBySession(state.id)).toBeNull();
  });

  it("rolls back order, item and address inserts when an upload cannot be claimed", async () => {
    const uploadId = randomUUID();
    const snapshot = cart([uploadId]);
    const state = await checkout({ snapshot });
    await checkoutRepository.createUpload({
      id: uploadId,
      checkoutSessionId: state.id,
      storageKey: `${uploadId}.jpg`, originalName: "photo.jpg",
      mediaType: "image/jpeg", sizeBytes: 100, sha256: "c".repeat(64),
    });
    await database.delete(checkoutUploads).where(eq(checkoutUploads.id, uploadId));

    await expect(repository.createAtomicOrder(pickupInput(state)))
      .rejects.toBeInstanceOf(UnclaimableUploadError);
    expect(await repository.findBySession(state.id)).toBeNull();
    expect(await database.select().from(orderItems)
      .where(eq(orderItems.checkoutSessionId, state.id))).toHaveLength(0);
    expect((await repository.getCheckoutState(state.id))?.completedAt).toBeNull();
  });

  it("rejects version, digest or address races under the checkout lock", async () => {
    const changedAddress = { ...address, postcode: "6011", region: "Wellington" };
    const changes = [
      { version: 99 },
      { cartDigest: "f".repeat(64) },
      { deliveryAddress: changedAddress },
    ];
    for (const change of changes) {
      const state = await checkout();
      await database.update(checkoutSessions).set(change)
        .where(eq(checkoutSessions.id, state.id));
      await expect(repository.createAtomicOrder(pickupInput(state)))
        .rejects.toBeInstanceOf(AtomicOrderStateError);
      expect(await repository.findBySession(state.id)).toBeNull();
    }
  });

  it("unwraps a real PostgreSQL order-number collision and lets the service retry", async () => {
    const duplicateNumber = `RNR-2026-DUP${suffix.replaceAll("-", "").slice(0, 7).toUpperCase()}`;
    const first = await checkout();
    await repository.createAtomicOrder({
      ...pickupInput(first),
      orderNumber: duplicateNumber,
    });

    const directCollision = await checkout();
    await expect(repository.createAtomicOrder({
      ...pickupInput(directCollision),
      orderNumber: duplicateNumber,
    })).rejects.toBeInstanceOf(OrderNumberCollisionError);

    const retried = await checkout();
    const uniqueNumber = `RNR-2026-OK${suffix.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    const numbers = [duplicateNumber, uniqueNumber];
    const service = createOrderService({
      repository,
      shippingService: createShippingService({ provider: null }),
      now: () => now,
      createOrderNumber: () => numbers.shift()!,
    });

    await expect(service.createOrder(retried.id, randomUUID(), { checkoutVersion: retried.version, cartDigest: retried.cartDigest!, shipping: { method: "pickup", serviceCode: "pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, isTest: false } })).resolves.toMatchObject({
      orderNumber: uniqueNumber,
    });
  });

  it("backfills completed_at for an order created before migration 0003", async () => {
    const state = await checkout();
    const order = await repository.createAtomicOrder(pickupInput(state));
    const [persistedOrder] = await database.select({ createdAt: orders.createdAt })
      .from(orders).where(eq(orders.id, order.id));
    await database.update(checkoutSessions).set({ completedAt: null })
      .where(eq(checkoutSessions.id, state.id));

    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0003_awesome_tattoo.sql"),
      "utf8",
    );
    const statement = migration
      .split("--> statement-breakpoint")
      .find((candidate) => candidate.includes(
        'UPDATE "checkout_sessions" AS "session_snapshot" SET "completed_at"',
      ));
    expect(statement).toBeDefined();
    await pool.query(statement!);

    expect((await repository.getCheckoutState(state.id))?.completedAt)
      .toEqual(persistedOrder.createdAt);
  });

  it("reads immutable guest and customer order snapshots only through their owner", async () => {
    const guestState = await checkout();
    const guestOrder = await repository.createAtomicOrder(pickupInput(guestState));
    await database.insert(paymentAttempts).values({
      orderId: guestOrder.id,
      provider: "local-test",
      method: "afterpay",
      idempotencyKey: `guest-payment-${randomUUID()}`,
      expectedAmountCents: guestOrder.totalInclGstCents,
      currency: "NZD",
      country: "NZ",
      status: "requires_action",
      createdAt: new Date("2026-08-02T12:01:00.000Z"),
      updatedAt: new Date("2026-08-02T12:01:00.000Z"),
    });
    const guest = await queryRepository.findByCheckoutToken(
      guestOrder.orderNumber,
      guestState.tokenDigest,
    );
    expect(guest).toMatchObject({
      orderNumber: guestOrder.orderNumber,
      deliveryMethod: "pickup",
      totals: { totalInclGstCents: 7_475 },
      payment: {
        method: "afterpay",
        status: "requires_action",
        canRetry: false,
        isTest: true,
      },
    });
    expect(guest?.items).toHaveLength(1);
    expect(guest?.addresses.billing).toEqual(address);
    expect(Object.isFrozen(guest)).toBe(true);
    expect(JSON.stringify(guest)).not.toMatch(
      /checkoutSessionId|tokenDigest|customerId|shippingQuoteId|providerReference|attemptId|clientSecret|returnState|failure|event|"id"/,
    );
    await expect(queryRepository.findByCheckoutToken(guestOrder.orderNumber, "wrong"))
      .resolves.toBeNull();

    await database.update(checkoutSessions).set({ expiresAt: new Date("2000-01-01T00:00:00.000Z") })
      .where(eq(checkoutSessions.id, guestState.id));
    await expect(queryRepository.findByCheckoutToken(
      guestOrder.orderNumber,
      guestState.tokenDigest,
    )).resolves.toBeNull();

    const customerState = await checkout({ customerId: customerIds[0] });
    const customerOrder = await repository.createAtomicOrder(pickupInput(customerState));
    await database.insert(paymentAttempts).values({
      orderId: customerOrder.id,
      provider: "stripe",
      method: "card",
      idempotencyKey: `customer-payment-${randomUUID()}`,
      expectedAmountCents: customerOrder.totalInclGstCents,
      currency: "NZD",
      country: "NZ",
      status: "failed",
      createdAt: new Date("2026-08-02T12:02:00.000Z"),
      updatedAt: new Date("2026-08-02T12:02:00.000Z"),
    });
    await expect(queryRepository.findByCheckoutToken(
      customerOrder.orderNumber,
      customerState.tokenDigest,
    )).resolves.toBeNull();
    const queryService = createOrderQueryService(queryRepository);
    await expect(queryService.confirmation(customerOrder.orderNumber, {
      tokenDigest: customerState.tokenDigest,
      userId: null,
    })).resolves.toBeNull();
    await expect(queryService.confirmation(customerOrder.orderNumber, {
      tokenDigest: customerState.tokenDigest,
      userId: customerIds[0],
    })).resolves.toMatchObject({
      orderNumber: customerOrder.orderNumber,
      payment: { method: "card", status: "failed", canRetry: true, isTest: false },
    });
    const history = await queryRepository.listByCustomer(customerIds[0]);
    expect(history.map(({ orderNumber }) => orderNumber)).toContain(customerOrder.orderNumber);
    await expect(queryRepository.findByCustomer(customerOrder.orderNumber, "other-user"))
      .resolves.toBeNull();
    await expect(queryRepository.findByCustomer(guestOrder.orderNumber, customerIds[0]))
      .resolves.toBeNull();
  });

  it("creates and reads a customer order needed more than five working days away", async () => {
    const snapshot = cart([], "2026-08-20");
    expect(snapshot.items[0].urgentService).toEqual({
      workingDays: 13,
      feeInclGstCents: 0,
    });
    const state = await checkout({ customerId: customerIds[0], snapshot });
    const created = await repository.createAtomicOrder(pickupInput(state));
    const queryService = createOrderQueryService(queryRepository);

    await expect(queryService.confirmation(created.orderNumber, {
      tokenDigest: state.tokenDigest,
      userId: customerIds[0],
    })).resolves.toMatchObject({
      orderNumber: created.orderNumber,
      items: [{
        neededDate: "2026-08-20",
        urgentServiceConfirmed: false,
        urgentWorkingDays: 13,
      }],
    });
    await expect(queryService.accountOrders(customerIds[0])).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ orderNumber: created.orderNumber }),
      ]),
    );
  });

  it("uses a stable order-number tie-breaker for equal customer order dates", async () => {
    const firstState = await checkout({ customerId: customerIds[0] });
    const secondState = await checkout({ customerId: customerIds[0] });
    const tag = suffix.replaceAll("-", "").slice(0, 7).toUpperCase();
    const first = await repository.createAtomicOrder(pickupInput(firstState, {
      orderNumber: `RNR-2026-${tag}A`,
    }));
    const second = await repository.createAtomicOrder(pickupInput(secondState, {
      orderNumber: `RNR-2026-${tag}Z`,
    }));
    const sameDate = new Date("2026-08-02T12:30:00.000Z");
    await database.update(orders).set({ createdAt: sameDate })
      .where(inArray(orders.id, [first.id, second.id]));

    const history = await queryRepository.listByCustomer(customerIds[0]);
    const tied = history
      .filter(({ orderNumber }) => orderNumber === first.orderNumber || orderNumber === second.orderNumber)
      .map(({ orderNumber }) => orderNumber);

    expect(tied).toEqual([second.orderNumber, first.orderNumber]);
  });

  it("serializes concurrent identical and different idempotency requests", async () => {
    const sameState = await checkout();
    const same = pickupInput(sameState);
    const sameResults = await Promise.all([
      repository.createAtomicOrder({ ...same, orderNumber: "RNR-2026-SAME000001" }),
      repository.createAtomicOrder({ ...same, orderNumber: "RNR-2026-SAME000002" }),
    ]);
    expect(new Set(sameResults.map(({ id }) => id)).size).toBe(1);

    const differentState = await checkout();
    const first = pickupInput(differentState, {
      idempotencyKey: "50000000-0000-4000-8000-000000000001",
      orderNumber: "RNR-2026-DIFF000001",
    });
    const second = {
      ...first,
      idempotencyKey: "50000000-0000-4000-8000-000000000002",
      orderNumber: "RNR-2026-DIFF000002",
    };
    const results = await Promise.allSettled([
      repository.createAtomicOrder(first),
      repository.createAtomicOrder(second),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(await database.select().from(orders)
      .where(eq(orders.checkoutSessionId, differentState.id))).toHaveLength(1);
  });
});
