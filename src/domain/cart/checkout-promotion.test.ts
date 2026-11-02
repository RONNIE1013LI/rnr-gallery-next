import { beforeEach, expect, it } from "vitest";
import { setActiveCustomerId } from "./browser-cart-scope";
import { clearActiveVoucherCode, readActiveVoucherCode, writeActiveVoucherCode } from "./checkout-promotion";

beforeEach(() => { sessionStorage.clear(); setActiveCustomerId(null); });
it("keeps a validated voucher scoped to the current account through checkout and refresh", () => {
  setActiveCustomerId("customer-a");
  writeActiveVoucherCode("THANKYOU-ACCOUNT-A");
  expect(readActiveVoucherCode()).toBe("THANKYOU-ACCOUNT-A");
  setActiveCustomerId("customer-b");
  expect(readActiveVoucherCode()).toBe("");
  setActiveCustomerId("customer-a");
  expect(readActiveVoucherCode()).toBe("THANKYOU-ACCOUNT-A");
  clearActiveVoucherCode();
  expect(readActiveVoucherCode()).toBe("");
  setActiveCustomerId(null);
});
