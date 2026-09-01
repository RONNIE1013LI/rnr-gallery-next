import { describe, expect, it } from "vitest";

import { safeAuthReturnPath } from "./safe-return-path";

describe("safeAuthReturnPath", () => {
  it("allows approved protected roots with local query and hash state", () => {
    expect(safeAuthReturnPath("/reply-assistant", "/admin")).toBe("/reply-assistant");
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
      "/%68%74%74%70%73%3A%2F%2Fevil.example/forms",
      "/%2f%2fevil.example/forms",
      "/%252f%252fevil.example/forms",
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

  it("rejects non-canonical and traversal-like paths", () => {
    for (const value of [
      "/admin/../shop",
      "/admin/%2e%2e/shop",
      "/admin/%252e%252e/shop",
      "/admin//orders",
      "/admin/%2forders",
      "/admin/%252forders",
      "/admin/./orders",
    ]) {
      expect(safeAuthReturnPath(value, "/admin")).toBe("/admin");
    }
  });

  it("preserves safe encoded route segments, query, and hash values", () => {
    const value = "/admin/customers/customer%3Aabc%40example.test?tab=orders#details";
    expect(safeAuthReturnPath(value, "/admin")).toBe(value);
  });
});
