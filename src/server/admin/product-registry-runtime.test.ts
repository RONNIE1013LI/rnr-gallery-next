import { describe, expect, it, vi } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";

const { cachedRegistry } = vi.hoisted(() => ({ cachedRegistry: vi.fn() }));
vi.mock("@/server/cache/public-cache-tags", () => ({
  cachePublicData: () => cachedRegistry,
  PUBLIC_CACHE_TAGS: { products: "products" },
}));
vi.mock("@/server/db/client", () => ({ getDatabase: vi.fn() }));
vi.mock("./product-registry-service", () => ({
  createDrizzleProductRegistryRepository: vi.fn(),
  createProductRegistryService: vi.fn(),
}));

import { getSafePublicProductRegistry } from "./product-registry-runtime";

describe("cached public registry", () => {
  it("applies current urgent fees to a previous-release cache without changing tax or product prices", async () => {
    const legacy = structuredClone(defaultProductRegistry);
    legacy.pricing.urgentServiceFeesInclGstCents = [8000, 7000, 6000, 5000];
    for (const market of ["NZ", "AU"] as const) {
      legacy.markets[market].urgentServiceFees = [8000, 7000, 6000, 5000].map((amount, index) => ({
        workingDays: index + 1, amountInclTaxCents: amount,
      }));
    }
    cachedRegistry.mockResolvedValue({ revision: 17, registry: legacy });
    const current = await getSafePublicProductRegistry();
    expect(current.revision).toBe(17);
    for (const market of ["NZ", "AU"] as const) {
      expect(current.registry.markets[market].urgentServiceFees.map((fee) => fee.amountInclTaxCents)).toEqual([6000, 5000, 0, 0]);
      expect(current.registry.markets[market].tax).toEqual(legacy.markets[market].tax);
      expect(current.registry.markets[market].products).toEqual(legacy.markets[market].products);
    }
    expect(legacy.pricing.urgentServiceFeesInclGstCents).toEqual([8000, 7000, 6000, 5000]);
  });
});
