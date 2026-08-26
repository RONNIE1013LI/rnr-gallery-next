import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import nextConfig, { buildSecurityHeaders } from "./next.config";

async function loadNextConfig(vercelEnv: string | undefined) {
  if (vercelEnv === undefined) {
    vi.unstubAllEnvs();
  } else {
    vi.stubEnv("VERCEL_ENV", vercelEnv);
  }
  vi.resetModules();
  return (await import("./next.config")).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Next.js workspace configuration", () => {
  it("keeps Turbopack scoped to this worktree", () => {
    const worktreeRoot = dirname(fileURLToPath(import.meta.url));

    expect(nextConfig.turbopack?.root).toBe(worktreeRoot);
  });

  it("keeps the developer rendering badge out of customer-facing local previews", () => {
    expect(nextConfig.devIndicators).toBe(false);
  });

  it("keeps customer routes compiled throughout a local review session", () => {
    expect(nextConfig.onDemandEntries?.maxInactiveAge).toBeGreaterThanOrEqual(
      12 * 60 * 60 * 1_000,
    );
    expect(nextConfig.onDemandEntries?.pagesBufferLength).toBeGreaterThanOrEqual(64);
  });

  it("keeps only the responsive Gallery widths used by production layouts", () => {
    expect(nextConfig.images?.localPatterns).toContainEqual({
      pathname: "/**",
      search: "",
    });
    expect(nextConfig.images?.localPatterns).toContainEqual({
      pathname: "/gallery-images/**",
    });
    expect(nextConfig.images?.imageSizes).toEqual([
      32, 48, 64, 96, 128, 256, 320, 384,
    ]);
    expect(nextConfig.images?.deviceSizes).toEqual([
      480, 640, 750, 828, 1080, 1200, 1920, 2048,
    ]);
    expect(nextConfig.images?.qualities).toEqual([60, 75]);
  });

  it.each([
    ["preview", true],
    ["production", false],
    [undefined, false],
  ])("disables image optimization only for Vercel %s deployments", async (vercelEnv, expected) => {
    const config = await loadNextConfig(vercelEnv);

    expect(config.images?.unoptimized).toBe(expected);
  });

  it("adds non-breaking browser security headers and production HSTS", () => {
    const headers = Object.fromEntries(
      buildSecurityHeaders("production").map(({ key, value }) => [key, value]),
    );

    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Strict-Transport-Security"]).toContain("max-age=31536000");
  });

  it("prevents token-bearing notification verification pages from being cached", async () => {
    const configuredHeaders = await nextConfig.headers?.();

    expect(configuredHeaders).toContainEqual({
      source: "/notification-email/verify/:token",
      headers: [{ key: "Cache-Control", value: "no-store" }],
    });
  });

  it("publishes the Forms portal at /order-system while preserving legacy links", async () => {
    const redirects = await nextConfig.redirects?.();
    const rewrites = await nextConfig.rewrites?.();

    expect(redirects).toContainEqual({
      source: "/forms/:path*",
      destination: "/order-system/:path*",
      permanent: false,
    });
    expect(rewrites).toContainEqual({
      source: "/order-system/:path*",
      destination: "/forms/:path*",
    });
  });

  it("permanently redirects the www root and every nested path to the apex host", async () => {
    const redirects = await nextConfig.redirects?.();

    expect(redirects).toContainEqual({
      source: "/:path*",
      destination: "https://rrgallery.co.nz/:path*",
      permanent: true,
      has: [{ type: "host", value: "www\\.rrgallery\\.co\\.nz" }],
    });
  });

  it("keeps canonical redirect queries intact and excludes Preview hosts", async () => {
    const redirects = await nextConfig.redirects?.();
    const canonicalRedirect = redirects?.find(
      (redirect) => redirect.destination === "https://rrgallery.co.nz/:path*",
    );

    expect(canonicalRedirect).toMatchObject({
      source: "/:path*",
      destination: "https://rrgallery.co.nz/:path*",
      permanent: true,
      has: [{ type: "host", value: "www\\.rrgallery\\.co\\.nz" }],
    });
    expect(canonicalRedirect?.destination).not.toContain("?");
  });

  it("matches only the exact www hostname for the canonical redirect", async () => {
    const redirects = await nextConfig.redirects?.();
    const canonicalRedirect = redirects?.find(
      (redirect) => redirect.destination === "https://rrgallery.co.nz/:path*",
    );
    const hostCondition = canonicalRedirect?.has?.find(
      (condition) => condition.type === "host",
    );
    const hostMatcher = new RegExp(`^${hostCondition?.value}$`);

    expect(hostMatcher.test("www.rrgallery.co.nz")).toBe(true);
    expect(hostMatcher.test("wwwXrrgalleryYcoZnz")).toBe(false);
  });
});
