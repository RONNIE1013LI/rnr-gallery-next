import { verifyReturningCustomerVoucher } from "./returning-customer-voucher";
import { THANK_YOU_OFFER_ENABLED } from "@/domain/promotions/thank-you-offer";
import { sql } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";

type Database = ReturnType<typeof getDatabase>;
type OfferDatabase = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export class FirstOrderOfferConflictError extends Error {
  constructor(message = "Your offer is reserved for an existing order. Resume that order from your account or contact our team before placing another order.") {
    super(message);
    this.name = "FirstOrderOfferConflictError";
  }
}

async function accountEmail(database: OfferDatabase, customerId: string) {
  const result = await database.execute<{ email: string }>(
    sql`select lower(email) as email from "user" where id = ${customerId}`,
  );
  return result.rows[0]?.email ?? null;
}

async function hasHistory(database: OfferDatabase, customerId: string, email: string, mode: "any" | "reserved" | "returning" = "any") {
  const result = await database.execute(sql`
    select id from orders
    where (customer_id = ${customerId} or lower(customer_email) = ${email})
      ${mode === "reserved" ? sql`and pricing_snapshot->'promotion'->>'key' in ('first-order-20-v1', 'returning-customer-36-v1')
        and payment_status not in ('paid', 'refunded')` : mode === "returning" ? sql`and pricing_snapshot->'promotion'->>'key' = 'returning-customer-36-v1'` : sql``}
    limit 1
  `);
  return result.rows.length > 0;
}

export async function isFirstOrderOfferEligible(database: OfferDatabase, customerId: string | null): Promise<boolean> {
  if (!THANK_YOU_OFFER_ENABLED || !customerId) return false;
  const email = await accountEmail(database, customerId);
  return email !== null && !await hasHistory(database, customerId, email);
}

// Call inside the same transaction as order insertion. Failed/cancelled orders
// retain their reservation because an earlier external payment can still settle.
export async function assertFirstOrderOfferAvailable(transaction: OfferDatabase, customerId: string, claimingOffer: boolean, claimingReturningOffer = false): Promise<void> {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`first-order-customer:${customerId}`}, 0))`);
  const email = await accountEmail(transaction, customerId);
  if (!email) throw new FirstOrderOfferConflictError();
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`first-order-offer:${email}`}, 0))`);
  if (claimingReturningOffer && await hasHistory(transaction, customerId, email, "returning")) {
    throw new FirstOrderOfferConflictError("This returning-customer voucher has already been reserved or used. Resume your existing order or contact our team.");
  }
  if (await hasHistory(transaction, customerId, email, claimingOffer ? "any" : "reserved")) {
    throw new FirstOrderOfferConflictError();
  }
}


export class InvalidReturningVoucherError extends Error {
  constructor(message = "This voucher is invalid for your account or has already been reserved or used.") {
    super(message);
    this.name = "InvalidReturningVoucherError";
  }
}

export async function isReturningOfferEligible(database: OfferDatabase, customerId: string | null): Promise<boolean> {
  if (!THANK_YOU_OFFER_ENABLED || !customerId) return false;
  const email = await accountEmail(database, customerId);
  return email !== null && !await hasHistory(database, customerId, email, "returning")
    && !await hasHistory(database, customerId, email, "reserved");
}

export async function resolveCustomerOffer(database: OfferDatabase, customerId: string | null, voucherCode: unknown, secret: string) {
  if (voucherCode !== undefined && voucherCode !== null && voucherCode !== "") {
    if (!customerId) throw new InvalidReturningVoucherError("Sign in to use your account's returning-customer voucher.");
    if (typeof voucherCode !== "string" || voucherCode.length > 80
      || !verifyReturningCustomerVoucher(voucherCode.trim().toUpperCase(), customerId, secret)
      || !await isReturningOfferEligible(database, customerId)) throw new InvalidReturningVoucherError();
    return { firstOrderDiscount: false, returningCustomerDiscount: true };
  }
  return { firstOrderDiscount: await isFirstOrderOfferEligible(database, customerId), returningCustomerDiscount: false };
}
