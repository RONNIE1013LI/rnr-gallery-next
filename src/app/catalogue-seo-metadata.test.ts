import { beforeEach, describe, expect, it, vi } from "vitest";

const market = vi.hoisted(() => ({ enabled: true, ready: true }));
vi.mock("@/components/catalogue-page", () => ({ CataloguePage: () => null }));
vi.mock("@/components/catalogue-buying-guide", () => ({ CatalogueBuyingGuide: () => null }));
vi.mock("@/domain/catalogue/product-registry", () => ({ getRegistryProducts: () => [] }));
vi.mock("@/domain/pricing/market-quote", () => ({ getMarketStartingPriceInclTaxCents: () => 0 }));
vi.mock("@/domain/catalogue/market-price-book", () => ({
  getMarketCompleteness: () => ({ ready: market.ready }),
}));
vi.mock("@/server/admin/product-registry-runtime", () => ({
  getSafePublicProductRegistry: async () => ({ registry: { markets: { AU: { enabled: market.enabled } } } }),
}));
vi.mock("@/server/seo/metadata", () => ({
  buildPublicMetadata: (input: Record<string, unknown>) => input,
}));

import { generateMetadata as canvasMetadata } from "./canvas/page";
import { generateMetadata as bannerMetadata } from "./banners/page";

beforeEach(() => {
  market.enabled = true;
  market.ready = true;
});

describe("NZ category metadata input", () => {
  it.each([
    ["/canvas", canvasMetadata, "Canvas Prints NZ | Personalised Canvas"],
    ["/banners", bannerMetadata, "Custom Banners NZ | Birthday & Memorial Banners"],
  ] as const)("describes %s and preserves its canonical path and market gate", async (path, generate, title) => {
    expect(await generate()).toMatchObject({ title, path, includeMarketAlternates: true });
    market.enabled = false;
    expect(await generate()).toMatchObject({ path, includeMarketAlternates: false });
    market.enabled = true;
    market.ready = false;
    expect(await generate()).toMatchObject({ path, includeMarketAlternates: false });
  });
});
