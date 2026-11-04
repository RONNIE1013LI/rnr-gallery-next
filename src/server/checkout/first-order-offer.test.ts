import { describe, expect, it, vi } from "vitest";
import { assertFirstOrderOfferAvailable, isFirstOrderOfferEligible, isReturningOfferEligible, resolveCustomerOffer, InvalidReturningVoucherError } from "./first-order-offer";
import { createReturningCustomerVoucher } from "./returning-customer-voucher";

function failingDatabase() {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  const database = {
    execute,
    select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: vi.fn().mockRejectedValue(new Error("read unavailable")) }) }) })),
  } as unknown as Parameters<typeof isFirstOrderOfferEligible>[0];
  return { database, execute };
}

describe("promotion state failures at checkout", () => {
  it("fails closed before account/history reads for both offer types", async () => {
    const { database, execute } = failingDatabase();
    expect(await isFirstOrderOfferEligible(database, "customer")).toBe(false);
    expect(await isReturningOfferEligible(database, "customer")).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([[true, false], [false, true]])("rejects atomic promotional claims on state read failure (%s, %s)", async (first, returning) => {
    const { database, execute } = failingDatabase();
    await expect(assertFirstOrderOfferAvailable(database, "customer", first, returning))
      .rejects.toThrow("This promotion has ended");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a valid returning voucher when authoritative state cannot be read", async () => {
    const { database } = failingDatabase();
    const secret = "test-only-voucher-secret-0123456789abcdef";
    const code = createReturningCustomerVoucher("customer", secret);
    await expect(resolveCustomerOffer(database, "customer", code, secret)).rejects.toBeInstanceOf(InvalidReturningVoucherError);
  });
});

function enabledDatabase() {
  const execute = vi.fn().mockResolvedValue({ rows: [{ email: "returning@example.test" }] });
  const database = {
    execute,
    select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: vi.fn().mockResolvedValue([{ publishedValue: "enabled" }]) }) }) })),
  } as unknown as Parameters<typeof isFirstOrderOfferEligible>[0];
  return { database, execute };
}

describe("unlimited promotional orders", () => {
  it("gives the base offer to guests and repeat accounts without querying order history", async () => {
    const { database, execute } = enabledDatabase();
    expect(await isFirstOrderOfferEligible(database, null)).toBe(true);
    expect(await isFirstOrderOfferEligible(database, "repeat-customer")).toBe(true);
    expect(await resolveCustomerOffer(database, null, undefined, "")).toEqual({ firstOrderDiscount: true, returningCustomerDiscount: false });
    expect(execute).not.toHaveBeenCalled();
  });
  it("allows the same valid account voucher repeatedly but rejects another account or guest", async () => {
    const { database } = enabledDatabase(); const secret = "test-only-voucher-secret-0123456789abcdef";
    const code = createReturningCustomerVoucher("repeat-customer", secret);
    for (let n = 0; n < 2; n++) expect(await resolveCustomerOffer(database, "repeat-customer", code, secret)).toEqual({ firstOrderDiscount: false, returningCustomerDiscount: true });
    await expect(resolveCustomerOffer(database, "other", code, secret)).rejects.toBeInstanceOf(InvalidReturningVoucherError);
    await expect(resolveCustomerOffer(database, null, code, secret)).rejects.toBeInstanceOf(InvalidReturningVoucherError);
  });
});
