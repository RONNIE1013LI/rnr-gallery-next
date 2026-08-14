import { describe, expect, it } from "vitest";

import { safeAuthReturnPath } from "./safe-return-path";

describe("safeAuthReturnPath", () => {
  it("allows account, admin, order-system, legacy forms, and checkout paths with local query and hash state", () => {
    expect(safeAuthReturnPath("/order-system?urgent=yes", "/account")).toBe("/order-system?urgent=yes");
    expect(safeAuthReturnPath("/order-system/jobs/abc#invoice", "/account")).toBe("/order-system/jobs/abc#invoice");
    expect(safeAuthReturnPath("/forms?urgent=yes", "/account")).toBe("/forms?urgent=yes");
    expect(safeAuthReturnPath("/forms/jobs/abc#invoice", "/account")).toBe("/forms/jobs/abc#invoice");
    expect(safeAuthReturnPath("/admin/orders", "/account")).toBe("/admin/orders");
    expect(safeAuthReturnPath("/account/orders", "/account")).toBe("/account/orders");
    expect(safeAuthReturnPath("/checkout", "/account")).toBe("/checkout");
  });

  it("rejects external, protocol-relative, malformed and encoded control paths", () => {
    for (const value of [
      "https://evil.example/forms",
      "//evil.example/forms",
      "/%5cevil.example/forms",
      "/forms%0aSet-Cookie:bad",
      "/shop",
      "javascript:alert(1)",
      "data:text/html,bad",
      "%E0%A4%A",
    ]) {
      expect(safeAuthReturnPath(value, "/account")).toBe("/account");
    }
  });
});
