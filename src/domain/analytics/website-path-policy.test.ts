import { describe, expect, it } from "vitest";
import {
  isTrackableWebsitePath,
  normalizeWebsitePathname,
} from "./website-path-policy";

describe("normalizeWebsitePathname", () => {
  it.each([
    ["/", "/"],
    ["/shop?utm_source=google&gclid=private", "/shop"],
    ["/products/canvas#sizes", "/products/canvas"],
    ["/shop/", "/shop"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeWebsitePathname(input)).toBe(expected);
  });

  it.each(["", "shop", "//other.example/path", "https://other.example/shop"])(
    "rejects invalid client pathname %s",
    (input) => {
      expect(normalizeWebsitePathname(input)).toBeNull();
    },
  );

  it("rejects a pathname beyond the database bound", () => {
    expect(normalizeWebsitePathname(`/${"a".repeat(512)}`)).toBeNull();
  });
});

describe("isTrackableWebsitePath", () => {
  it.each(["/", "/shop", "/products/canvas", "/contact", "/au/banners"])(
    "allows public path %s",
    (pathname) => {
      expect(isTrackableWebsitePath(pathname)).toBe(true);
    },
  );

  it.each([
    "/admin",
    "/admin/orders",
    "/api/analytics/page-view",
    "/account",
    "/checkout",
    "/forms",
    "/notification-email/verify/token",
    "/order-system",
    "/orders/123",
    "/pay/token",
    "/_next/static/app.js",
    "/robots.txt",
    "/sitemap.xml",
    "/favicon.ico",
    "/media/image.webp",
  ])("blocks private or non-page path %s", (pathname) => {
    expect(isTrackableWebsitePath(pathname)).toBe(false);
  });
});
