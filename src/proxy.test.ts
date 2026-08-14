import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

describe("protected request proxy", () => {
  it.each([
    ["http://localhost/admin/users?q=staff", "/admin/users?q=staff"],
    ["http://localhost/order-system/stats?range=30d", "/order-system/stats?range=30d"],
    ["http://localhost/order-system/new?source=manual", "/order-system/new?source=manual"],
  ])("forwards the exact safe path and query for %s", (url, expected) => {
    const response = proxy(new NextRequest(url));

    expect(response.headers.get("x-middleware-request-x-rnr-request-path"))
      .toBe(expected);
  });

  it("runs for the public order-system route", () => {
    expect(config.matcher).toContain("/order-system/:path*");
  });
});
