import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

describe("obvious security probe paths", () => {
  it.each([
    "/.env",
    "/.env.production",
    "/.git",
    "/.git/config",
    "/xmlrpc.php",
    "/shell.php",
    "/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php",
  ])("terminates %s before it reaches application routing", (pathname) => {
    const response = proxy(new NextRequest(`https://rnrgallery.com${pathname}`));

    expect(response.status).toBe(410);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("cache-control"))
      .toBe("public, max-age=0, must-revalidate");
  });

  it.each([
    "/favicon.ico",
    "/asset.with-dots",
    "/products/photo-print-canvas",
    "/api/payments/stripe/webhook",
  ])("does not classify the legitimate path %s as a security probe", (pathname) => {
    const response = proxy(new NextRequest(`https://rnrgallery.com${pathname}`));

    expect(response.status).not.toBe(410);
  });
});
