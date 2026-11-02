import { describe, expect, it } from "vitest";
import { createReturningCustomerVoucher, verifyReturningCustomerVoucher } from "./returning-customer-voucher";
const secret = "test-only-returning-voucher-secret-123456789";
describe("returning customer voucher", () => {
  it("creates a deterministic uppercase code bound to one account and secret", () => {
    const code = createReturningCustomerVoucher("customer-1", secret);
    expect(code).toMatch(/^THANKYOU-[A-F0-9]{32}$/);
    expect(createReturningCustomerVoucher("customer-1", secret)).toBe(code);
    expect(verifyReturningCustomerVoucher(code, "customer-1", secret)).toBe(true);
    expect(verifyReturningCustomerVoucher(code, "customer-2", secret)).toBe(false);
    expect(verifyReturningCustomerVoucher(code, "customer-1", `${secret}changed`)).toBe(false);
    expect(verifyReturningCustomerVoucher(`${code.slice(0, -1)}Z`, "customer-1", secret)).toBe(false);
    expect(verifyReturningCustomerVoucher(code.toLowerCase(), "customer-1", secret)).toBe(false);
  });
  it("fails closed for unavailable identity or secret", () => {
    expect(() => createReturningCustomerVoucher("", secret)).toThrow();
    expect(() => createReturningCustomerVoucher("customer-1", "short")).toThrow();
    expect(verifyReturningCustomerVoucher("anything", "customer-1", "short")).toBe(false);
    expect(verifyReturningCustomerVoucher("anything", "", secret)).toBe(false);
  });
});
