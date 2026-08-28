import { describe, expect, it, vi } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { generateMetadata as generateAustraliaConfigureMetadata } from "./au/products/[slug]/configure/page";
import { generateMetadata as generateNewZealandConfigureMetadata } from "./products/[slug]/configure/page";

vi.mock("@/server/admin/product-registry-runtime", () => ({
  getSafePublicProductRegistry: async () => ({ registry: defaultProductRegistry }),
}));

describe("configure route metadata", () => {
  it.each([
    ["New Zealand", generateNewZealandConfigureMetadata],
    ["Australia", generateAustraliaConfigureMetadata],
  ])("keeps the %s configurator out of search results", async (_market, generateMetadata) => {
    await expect(generateMetadata({
      params: Promise.resolve({ slug: "photo-print-canvas" }),
      searchParams: Promise.resolve({}),
    })).resolves.toMatchObject({
      robots: { index: false, follow: false },
    });
  });
});
