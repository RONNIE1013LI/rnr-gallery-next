import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { createGoogleMerchantFeedRoute } from "@/server/merchant/google-merchant-feed";

describe("Google Merchant feed routes", () => {
  afterEach(() => {
    vi.doUnmock("@/server/admin/product-registry-runtime");
    vi.resetModules();
  });

  it("serves only public NZ XML fields with RSS headers", async () => {
    const route = createGoogleMerchantFeedRoute({
      market: "NZ",
      current: async () => ({ registry: defaultProductRegistry }),
      siteUrl: new URL("https://rnrgallery.com"),
      now: () => new Date("2026-08-28T00:00:00.000Z"),
    });

    const response = await route.GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/rss+xml; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=");
    expect(await response.text()).toContain("https://rnrgallery.com/products/");
  });

  it("fails closed for an Australian market that is not enabled and ready", async () => {
    const route = createGoogleMerchantFeedRoute({
      market: "AU",
      current: async () => ({ registry: defaultProductRegistry }),
      siteUrl: new URL("https://rnrgallery.com"),
    });

    const response = await route.GET();

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("Merchant feed unavailable.");
  });

  it.each([
    ["NZ", "./google-merchant-nz.xml/route"],
    ["AU", "./google-merchant-au.xml/route"],
  ] as const)("uses the live registry read and fails closed when %s loading rejects", async (_market, modulePath) => {
    const current = vi.fn().mockRejectedValue(new Error("registry unavailable"));
    const getSafePublicProductRegistry = vi.fn().mockResolvedValue({
      registry: defaultProductRegistry,
    });
    vi.doMock("@/server/admin/product-registry-runtime", () => ({
      getProductRegistryRuntime: () => ({ current }),
      getSafePublicProductRegistry,
    }));

    const { GET } = await import(modulePath);
    const response = await GET();

    expect(current).toHaveBeenCalledOnce();
    expect(getSafePublicProductRegistry).not.toHaveBeenCalled();
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("Merchant feed unavailable.");
  });
});
