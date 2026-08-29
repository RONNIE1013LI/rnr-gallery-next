import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import nextConfig, { buildSecurityHeaders } from "./next.config";
import { products } from "./src/domain/catalogue/products";

const knownStaticMigrationTargets = new Set([
  "/about",
  "/banners",
  "/canvas",
  "/design-gallery",
  "/privacy",
]);

async function readLegacyUrlMap() {
  const root = dirname(fileURLToPath(import.meta.url));
  const csv = await readFile(`${root}/docs/seo/legacy-url-map.csv`, "utf8");
  const [header, ...lines] = csv.trim().split("\n");
  const columns = header.split(",");

  return lines.map((line) => Object.fromEntries(
    line.split(",").map((value, index) => [columns[index], value]),
  ));
}

function isCurrentMigrationTarget(target: string) {
  if (knownStaticMigrationTargets.has(target)) return true;
  const product = target.match(/^\/products\/([^/]+)$/)?.[1];
  return product !== undefined && products.some(({ slug, active }) => active && slug === product);
}

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

  it("delegates trailing-slash canonicalization so approved legacy URLs can redirect in one hop", () => {
    expect(nextConfig.skipTrailingSlashRedirect).toBe(true);
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

  it("leaves request-aware canonical and legacy redirects to proxy", async () => {
    const redirects = await nextConfig.redirects?.();

    expect(redirects).toEqual([{
      source: "/forms/:path*",
      destination: "/order-system/:path*",
      permanent: false,
    }]);
  });

  it("keeps the legacy URL migration inventory internally safe", async () => {
    const rows = await readLegacyUrlMap();
    const activeRows = rows.filter((row) => row.redirect_status === "301");
    const activeSources = new Set(activeRows.map((row) =>
      new URL(row.old_url).pathname.replace(/\/$/, "") || "/",
    ));

    expect(activeRows).toHaveLength(41);
    expect(activeRows.every((row) => row.classification === "exact-301")).toBe(true);

    for (const row of activeRows) {
      const source = new URL(row.old_url).pathname.replace(/\/$/, "") || "/";
      const destinationUrl = new URL(row.new_url);
      const destination = destinationUrl.pathname;

      expect(source).not.toBe("/");
      expect(destination).not.toBe("/");
      expect(destinationUrl.search).toBe("");
      expect(source).not.toContain(":");
      expect(source).not.toContain("*");
      expect(activeSources.has(destination)).toBe(false);
      expect(isCurrentMigrationTarget(destination)).toBe(true);
    }
  });

  it("records only the approved mapping decisions in the legacy inventory", async () => {
    const rows = await readLegacyUrlMap();
    const cookiesPolicy = rows.find((row) => row.old_url.endsWith("/cookies-policy/"));
    const retiredRows = rows.filter((row) => row.classification === "retired-410");
    const unresolvedMediumProducts = rows.filter((row) =>
      row.classification === "review-required"
      && row.confidence === "medium"
      && new URL(row.new_url).pathname.startsWith("/products/"),
    );
    const lowConfidenceRows = rows.filter((row) => row.confidence === "low");

    expect(cookiesPolicy).toMatchObject({
      new_url: "https://rnrgallery.com/privacy",
      classification: "exact-301",
      redirect_status: "301",
      confidence: "high",
    });
    expect(unresolvedMediumProducts).toHaveLength(0);
    expect(retiredRows).toHaveLength(27);
    expect(retiredRows.every((row) => row.redirect_status === "410")).toBe(true);
    expect(lowConfidenceRows.every((row) => row.redirect_status === "410")).toBe(true);
    expect(rows.filter((row) => row.classification === "retire-candidate"))
      .toHaveLength(0);
  });
});
