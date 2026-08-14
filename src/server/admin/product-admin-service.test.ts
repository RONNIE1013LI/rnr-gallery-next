import { describe, expect, it } from "vitest";
import { products } from "@/domain/catalogue/products";
import { configurationSchemas } from "@/domain/configuration/schemas";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { listAdminProducts } from "./product-admin-service";

describe("admin product source projection", () => {
  it("projects every live product from the existing pricing source", () => {
    const result = listAdminProducts();
    expect(result).toHaveLength(products.length);
    for (const product of result) {
      const catalogue = products.find((candidate) => candidate.key === product.key)!;
      const schema = configurationSchemas.find((candidate) => candidate.productKey === product.key)!;
      expect(product).toMatchObject({
        key: catalogue.key,
        slug: catalogue.slug,
        title: catalogue.title,
        category: catalogue.category,
        active: catalogue.active,
        featured: catalogue.featured,
        startingPriceExGstCents: catalogue.startingPriceExGstCents,
      });
      expect(product.sizes).toEqual(schema.sizes);
    }
  });

  it("exposes actual extras without deriving a second price", () => {
    const rollUp = listAdminProducts().find((product) => product.key === "roll-up-banner")!;
    expect(rollUp).toMatchObject({
      includedPhotos: 5,
      extraPhotoPriceExGstCents: 500,
      extraBackgroundRemovalFeeInclGstCents: 2000,
    });
    const digitalOil = listAdminProducts().find((product) => product.key === "digital-oil-painting-canvas")!;
    expect(digitalOil.peoplePetsMode).toBe("required");
  });

  it("projects administrator-published values instead of baseline constants", () => {
    const registry = structuredClone(defaultProductRegistry);
    const rollUp = registry.products.find((product) => product.key === "roll-up-banner")!;
    rollUp.title = "Premium Roll-Up Banner";
    rollUp.configuration.sizes[0].priceExGstCents = 24_000;

    const result = listAdminProducts(registry).find(
      (product) => product.key === "roll-up-banner",
    );

    expect(result).toMatchObject({
      title: "Premium Roll-Up Banner",
      startingPriceExGstCents: 24_000,
      minimumConfiguredPriceExGstCents: 24_000,
    });
  });
});
