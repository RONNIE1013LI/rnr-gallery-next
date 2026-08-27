import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { australianCommerceDestination } from "@/domain/markets/market";
import { config, proxy } from "./proxy";

function activeLegacyRedirects() {
  const [header, ...lines] = readFileSync(
    resolve(process.cwd(), "docs/seo/legacy-url-map.csv"),
    "utf8",
  ).trim().split("\n");
  const columns = header.split(",");
  return lines
    .map((line) => Object.fromEntries(
      line.split(",").map((value, index) => [columns[index], value]),
    ))
    .filter((row) => row.redirect_status === "301");
}

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

  it.each([
    "/api/auth/callback/google/",
    "/_next/static/chunk.js/",
    "/_next/image/",
    "/favicon.ico/",
    "/robots.txt/",
    "/sitemap.xml/",
    "/asset.with-dots/",
  ])("runs early canonical handling for previously matcher-excluded %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig, url })).toBe(true);

    const response = proxy(new NextRequest("https://rnrgallery.com" + url));
    expect(response.status).toBe(308);
    expect(response.headers.get("location"))
      .toBe("https://rnrgallery.com" + url.slice(0, -1));
  });

  it.each([
    "/api/auth/callback/google",
    "/_next/static/chunk.js",
    "/_next/image",
    "/favicon.ico",
    "/robots.txt",
    "/sitemap.xml",
    "/asset.with-dots",
  ])("does not apply storefront market logic to excluded %s", (url) => {
    const response = proxy(new NextRequest("https://rnrgallery.com" + url, {
      headers: { "x-vercel-ip-country": "AU", "user-agent": "Mozilla/5.0" },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-rnr-resolved-market"))
      .toBeNull();
  });

  it("keeps unrelated customer pages on the existing slashless canonical form", () => {
    const response = proxy(new NextRequest(
      "https://rnrgallery.com/how-it-works/?utm_source=customer-link",
    ));

    expect(response.status).toBe(308);
    expect(response.headers.get("location"))
      .toBe("https://rnrgallery.com/how-it-works?utm_source=customer-link");
  });

  it("redirects every exact legacy path from a local Production host in one hop", () => {
    const rows = activeLegacyRedirects();

    expect(rows).toHaveLength(41);
    for (const row of rows) {
      const oldPath = new URL(row.old_url).pathname.replace(/\/$/, "");
      const expected = `${row.new_url}?utm_source=test&gclid=test`;

      for (const source of [oldPath, `${oldPath}/`]) {
        const response = proxy(new NextRequest(
          `http://127.0.0.1:3010${source}?utm_source=test&gclid=test`,
        ));
        expect(response.status, source).toBe(301);
        expect(response.headers.get("location"), source).toBe(expected);
      }

      const destinationResponse = proxy(new NextRequest(row.new_url));
      expect(destinationResponse.headers.get("location"), row.new_url).toBeNull();
    }
  });

  it("resolves every legacy mapping directly to its final Australian route", () => {
    for (const row of activeLegacyRedirects()) {
      const oldPath = new URL(row.old_url).pathname;
      const targetPath = new URL(row.new_url).pathname;
      const marketPath = australianCommerceDestination(targetPath) ?? targetPath;
      const expected = "https://rnrgallery.com" + marketPath
        + "?utm_source=test&gclid=test";
      const headers = {
        "x-vercel-ip-country": "AU",
        "user-agent": "Mozilla/5.0",
      };
      const response = proxy(new NextRequest(
        "https://rrgallery.co.nz" + oldPath + "?utm_source=test&gclid=test",
        { headers },
      ));

      expect(response.status, oldPath).toBe(301);
      expect(response.headers.get("location"), oldPath).toBe(expected);

      const destinationResponse = proxy(new NextRequest(expected, { headers }));
      expect(destinationResponse.headers.get("location"), expected).toBeNull();
    }
  });

  it("uses a saved Australian preference for a single-hop legacy redirect", () => {
    const response = proxy(new NextRequest(
      "https://rnrgallery.com/product/banner-bundle/?utm_source=saved",
      {
        headers: {
          cookie: "rnr-market=AU",
          "x-vercel-ip-country": "NZ",
          "user-agent": "Mozilla/5.0",
        },
      },
    ));

    expect(response.status).toBe(301);
    expect(response.headers.get("location"))
      .toBe("https://rnrgallery.com/au/products/banner-bundle?utm_source=saved");
  });

  it("keeps a saved New Zealand preference on the final NZ legacy destination", () => {
    const response = proxy(new NextRequest(
      "https://rnrgallery.com/product/banner-bundle/?utm_source=saved",
      {
        headers: {
          cookie: "rnr-market=NZ",
          "x-vercel-ip-country": "AU",
          "user-agent": "Mozilla/5.0",
        },
      },
    ));

    expect(response.status).toBe(301);
    expect(response.headers.get("location"))
      .toBe("https://rnrgallery.com/products/banner-bundle?utm_source=saved");
  });

  it("preserves canonical host redirects for unrelated public pages only", () => {
    const response = proxy(new NextRequest(
      "https://www.rrgallery.co.nz/shop?campaign=legacy",
    ));

    expect(response.status).toBe(301);
    expect(response.headers.get("location"))
      .toBe("https://rnrgallery.com/shop?campaign=legacy");

    const apiResponse = proxy(new NextRequest(
      "https://www.rrgallery.co.nz/api/auth/callback/google",
    ));
    expect(apiResponse.status).toBe(200);
    expect(apiResponse.headers.get("location")).toBeNull();
  });

  it("redirects a first Australian storefront request before rendering and preserves its query", () => {
    const response = proxy(new NextRequest("https://rnrgallery.com/shop?utm_source=google", {
      headers: { "x-vercel-ip-country": "AU", "user-agent": "Mozilla/5.0" },
    }));

    expect(response.status).toBe(307);
    expect(response.headers.get("location"))
      .toBe("https://rnrgallery.com/au/shop?utm_source=google");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("lets a saved NZ preference override an Australian IP", () => {
    const request = new NextRequest("https://rnrgallery.com/shop", {
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
    const response = proxy(new NextRequest("https://rnrgallery.com/shop", {
      headers: {
        cookie: "rnr-market=AU",
        "x-vercel-ip-country": "NZ",
        "user-agent": "Mozilla/5.0",
      },
    }));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://rnrgallery.com/au/shop");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("ignores an invalid preference cookie and falls back to supported geo detection", () => {
    const response = proxy(new NextRequest("https://rnrgallery.com/shop", {
      headers: {
        cookie: "rnr-market=US",
        "x-vercel-ip-country": "AU",
        "user-agent": "Mozilla/5.0",
      },
    }));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://rnrgallery.com/au/shop");
  });

  it("honours an explicit AU URL without overwriting a saved NZ preference", () => {
    const response = proxy(new NextRequest("https://rnrgallery.com/au/products/photo-print-canvas", {
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
    const response = proxy(new NextRequest("https://rnrgallery.com/products/photo-print-canvas", {
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
    const response = proxy(new NextRequest("https://rnrgallery.com/help", {
      headers: { "x-vercel-ip-country": "US", "user-agent": "Mozilla/5.0" },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-request-x-rnr-resolved-market"))
      .toBe("NZ");
    expect(response.headers.get("x-middleware-request-x-rnr-market-source"))
      .toBe("fallback");
  });
});
