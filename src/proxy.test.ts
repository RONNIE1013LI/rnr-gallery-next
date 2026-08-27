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
    expect(config.matcher).toHaveLength(1);
    const response = proxy(new NextRequest("http://localhost/order-system"));
    expect(response.headers.get("x-middleware-request-x-rnr-request-path"))
      .toBe("/order-system");
  });

  it("keeps unrelated customer pages on the existing slashless canonical form", () => {
    const response = proxy(new NextRequest(
      "https://rnrgallery.com/how-it-works/?utm_source=customer-link",
    ));

    expect(response.status).toBe(308);
    expect(response.headers.get("location"))
      .toBe("https://rnrgallery.com/how-it-works?utm_source=customer-link");
  });

  it("redirects a first Australian storefront request before rendering and preserves its query", () => {
    const response = proxy(new NextRequest("https://rrgallery.co.nz/shop?utm_source=google", {
      headers: { "x-vercel-ip-country": "AU", "user-agent": "Mozilla/5.0" },
    }));

    expect(response.status).toBe(307);
    expect(response.headers.get("location"))
      .toBe("https://rrgallery.co.nz/au/shop?utm_source=google");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("lets a saved NZ preference override an Australian IP", () => {
    const request = new NextRequest("https://rrgallery.co.nz/shop", {
      headers: {
        cookie: "rnr-market=NZ",
        "x-vercel-ip-country": "AU",
        "x-rnr-resolved-market": "AU",
        "user-agent": "Mozilla/5.0",
      },
    });
    const response = proxy(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-request-x-rnr-resolved-market"))
      .toBe("NZ");
    expect(response.headers.get("x-middleware-request-x-rnr-market-source"))
      .toBe("saved");
  });

  it("lets a saved AU preference override a New Zealand IP across navigation", () => {
    const response = proxy(new NextRequest("https://rrgallery.co.nz/shop", {
      headers: {
        cookie: "rnr-market=AU",
        "x-vercel-ip-country": "NZ",
        "user-agent": "Mozilla/5.0",
      },
    }));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://rrgallery.co.nz/au/shop");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("ignores an invalid preference cookie and falls back to supported geo detection", () => {
    const response = proxy(new NextRequest("https://rrgallery.co.nz/shop", {
      headers: {
        cookie: "rnr-market=US",
        "x-vercel-ip-country": "AU",
        "user-agent": "Mozilla/5.0",
      },
    }));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://rrgallery.co.nz/au/shop");
  });

  it("honours an explicit AU URL without overwriting a saved NZ preference", () => {
    const response = proxy(new NextRequest("https://rrgallery.co.nz/au/products/photo-print-canvas", {
      headers: {
        cookie: "rnr-market=NZ",
        "x-vercel-ip-country": "NZ",
        "user-agent": "Mozilla/5.0",
      },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-request-x-rnr-resolved-market"))
      .toBe("AU");
    expect(response.headers.get("x-middleware-request-x-rnr-market-source"))
      .toBe("route");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("does not geo-redirect crawlers", () => {
    const response = proxy(new NextRequest("https://rrgallery.co.nz/products/photo-print-canvas", {
      headers: {
        "x-vercel-ip-country": "AU",
        "user-agent": "Googlebot/2.1",
      },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-request-x-rnr-resolved-market"))
      .toBe("NZ");
  });

  it("falls back to NZ when geo metadata is unsupported", () => {
    const response = proxy(new NextRequest("https://rrgallery.co.nz/help", {
      headers: { "x-vercel-ip-country": "US", "user-agent": "Mozilla/5.0" },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-request-x-rnr-resolved-market"))
      .toBe("NZ");
    expect(response.headers.get("x-middleware-request-x-rnr-market-source"))
      .toBe("fallback");
  });
});
