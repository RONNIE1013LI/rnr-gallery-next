import { verifyReturningCustomerVoucher } from "./returning-customer-voucher";
import { isThankYouOfferEnabled } from "@/server/promotions/thank-you-offer-state";
import { sql } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";

type Database = ReturnType<typeof getDatabase>;
type OfferDatabase = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export class FirstOrderOfferConflictError extends Error {
  constructor(message = "This promotional price could not be confirmed. Refresh checkout and review your total.") {
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

// Legacy function/storage names remain compatible with already-created checkout snapshots.
// During the campaign the base 20% offer is available on every order, including guests.
export async function isFirstOrderOfferEligible(database: OfferDatabase, _customerId: string | null): Promise<boolean> {
  return isThankYouOfferEnabled(database);
}

// Recheck the campaign inside the order transaction, including guest orders.
// Existing order retries return before this check and retain their stored amounts.
export async function assertFirstOrderOfferAvailable(transaction: OfferDatabase, customerId: string | null, claimingOffer: boolean, claimingReturningOffer = false): Promise<void> {
  if (!claimingOffer && !claimingReturningOffer) return;
  if (!await isThankYouOfferEnabled(transaction)) {
    throw new FirstOrderOfferConflictError("This promotion has ended. Refresh your checkout to see current pricing.");
  }
  if (claimingReturningOffer && (!customerId || !await accountEmail(transaction, customerId))) {
    throw new FirstOrderOfferConflictError("Sign in to the account linked to your returning-customer voucher.");
  }
}


export class InvalidReturningVoucherError extends Error {
  constructor(message = "This voucher is invalid for your account or the promotion is unavailable.") {
    super(message);
    this.name = "InvalidReturningVoucherError";
  }
}

export async function isReturningOfferEligible(database: OfferDatabase, customerId: string | null): Promise<boolean> {
  if (!customerId || !await isThankYouOfferEnabled(database)) return false;
  const email = await accountEmail(database, customerId);
  return email !== null;
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
