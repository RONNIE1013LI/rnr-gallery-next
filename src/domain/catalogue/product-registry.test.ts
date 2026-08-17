import { describe, expect, it } from "vitest";
import { quoteConfiguration } from "@/domain/configuration/quote";
import { getUrgentService } from "@/domain/scheduling/urgent-service";
import { synchronizeNewZealandPriceBook } from "./market-price-book";
import {
  defaultProductRegistry,
  getRegistryProductBySlug,
  parseProductRegistry,
  schemaFromRegistry,
} from "./product-registry";

describe("authoritative product registry", () => {
  it("adds only missing Bundle baseline rows to older published registry revisions", () => {
    const legacy = structuredClone(defaultProductRegistry);
    legacy.products = legacy.products.filter((product) => product.key !== "banner-bundle");
    for (const market of [legacy.markets.NZ, legacy.markets.AU]) {
      market.products = market.products.filter(
        (product) => product.productKey !== "banner-bundle",
      );
    }

    const auRollUp = legacy.markets.AU.products.find(
      (product) => product.productKey === "roll-up-banner",
    )!;
    const auWallBanner = legacy.markets.AU.products.find(
      (product) => product.productKey === "custom-themed-wall-banner",
    )!;
    auRollUp.sizes[0].amountInclTaxCents = 41_234;
    auRollUp.charges[0].amountInclTaxCents = 1_234;
    auRollUp.charges[1].amountInclTaxCents = 2_345;
    auWallBanner.charges[0].amountInclTaxCents = 3_456;
    auWallBanner.charges[1].amountInclTaxCents = 4_567;
    legacy.markets.AU.tax = { registered: true, rateBasisPoints: 1_234 };

    const parsed = parseProductRegistry(legacy);
    const bundle = parsed.products.find((product) => product.key === "banner-bundle");
    const auBundle = parsed.markets.AU.products.find(
      (product) => product.productKey === "banner-bundle",
    );

    expect(bundle?.configuration.sizes.map((size) => size.key)).toEqual([
      "rollup-wall-200x100",
      "rollup-wall-300x150",
    ]);
    expect(parsed.markets.AU.tax).toEqual({ registered: true, rateBasisPoints: 1_234 });
    expect(
      parsed.markets.AU.products.find(
        (product) => product.productKey === "roll-up-banner",
      )?.sizes[0].amountInclTaxCents,
    ).toBe(41_234);
    expect(auBundle).toMatchObject({
      sizes: [
        { sizeKey: "rollup-wall-200x100", amountInclTaxCents: 33_999 },
        { sizeKey: "rollup-wall-300x150", amountInclTaxCents: 46_999 },
      ],
      charges: [
        { key: "roll-up-extra-photo", amountInclTaxCents: 1_234 },
        { key: "roll-up-background-removal", amountInclTaxCents: 2_345 },
        { key: "wall-banner-extra-photo", amountInclTaxCents: 3_456 },
        { key: "wall-banner-background-removal", amountInclTaxCents: 4_567 },
      ],
    });
  });

  it("ships a complete NZ price book and a disabled empty AU price book", () => {
    expect(defaultProductRegistry.schemaVersion).toBe(2);
    expect(defaultProductRegistry.markets.NZ).toMatchObject({
      market: "NZ",
      currency: "NZD",
      enabled: true,
    });
    expect(defaultProductRegistry.markets.AU).toMatchObject({
      market: "AU",
      currency: "AUD",
      enabled: false,
      tax: { registered: false, rateBasisPoints: 1_000 },
    });
  });

  it("upgrades legacy product imagery while preserving administrator-selected media", () => {
    const legacy = structuredClone(defaultProductRegistry);
    const legacySources: Record<string, string> = {
      "photo-print-canvas": "/media/home/family-canvas.webp",
      "digital-oil-painting-canvas": "/media/home/digital-oil-pet.webp",
      "custom-themed-canvas": "/media/home/family-canvas.webp",
      "roll-up-banner": "/media/home/roll-up-banner.webp",
      "banner-bundle": "/media/products/banner-bundle.png",
      "custom-themed-wall-banner": "/media/home/wall-banner.webp",
      "digital-oil-painting-banner": "/media/home/wall-banner.webp",
      "grave-cover": "/media/home/roll-up-banner.webp",
    };
    for (const product of legacy.products) {
      product.image.src = legacySources[product.key];
      product.image.alt = "Legacy product image description";
    }

    const customMedia = structuredClone(legacy);
    const photoPrint = customMedia.products.find(
      (product) => product.key === "photo-print-canvas",
    )!;
    photoPrint.image = {
      src: "/media/custom/photo-print-canvas.webp",
      alt: "Administrator-selected photo print canvas",
    };

    const parsedLegacy = parseProductRegistry(legacy);
    const parsedCustomMedia = parseProductRegistry(customMedia);

    expect(new Set(parsedLegacy.products.map((product) => product.image.src))).toHaveLength(8);
    expect(
      parsedCustomMedia.products.find(
        (product) => product.key === "photo-print-canvas",
      )?.image,
    ).toEqual(photoPrint.image);
    expect(
      legacy.products.find((product) => product.key === "photo-print-canvas")?.image.src,
    ).toBe("/media/home/family-canvas.webp");
  });

  it("upgrades the legacy roll-up banner introduction without changing custom copy", () => {
    for (const legacySummary of [
      "A portable personalised display with stand, carry bag and custom artwork.",
      "A custom 85 cm × 200 cm roll-up banner with its display hardware.",
    ]) {
      const legacy = structuredClone(defaultProductRegistry);
      const rollUp = legacy.products.find((product) => product.key === "roll-up-banner");
      if (!rollUp) throw new Error("Missing roll-up banner fixture");
      rollUp.summary = legacySummary;

      expect(
        parseProductRegistry(legacy).products.find(
          (product) => product.key === "roll-up-banner",
        )?.summary,
      ).toBe(
        "Our roll-up banner includes custom design, an 85 × 200 cm printed banner, stand, carry bag, pegs and box.",
      );
    }

    const customised = structuredClone(defaultProductRegistry);
    const customisedRollUp = customised.products.find(
      (product) => product.key === "roll-up-banner",
    );
    if (!customisedRollUp) throw new Error("Missing roll-up banner fixture");
    customisedRollUp.summary = "Custom administrator copy.";

    expect(
      parseProductRegistry(customised).products.find(
        (product) => product.key === "roll-up-banner",
      )?.summary,
    ).toBe("Custom administrator copy.");
  });

  it("derives the public starting price from the lowest configured size", () => {
    const input = structuredClone(defaultProductRegistry);
    const product = input.products.find(
      (candidate) => candidate.key === "digital-oil-painting-canvas",
    )!;
    product.configuration.sizes[0].priceExGstCents = 7_100;
    synchronizeNewZealandPriceBook(input);

    const registry = parseProductRegistry(input);

    expect(
      getRegistryProductBySlug(registry, "digital-oil-painting-canvas")
        ?.startingPriceExGstCents,
    ).toBe(11_100);
  });

  it("rejects a document that changes immutable product or size identities", () => {
    const changedProduct = structuredClone(defaultProductRegistry);
    changedProduct.products[0].slug = "different-route";
    expect(() => parseProductRegistry(changedProduct)).toThrow(
      "Product structure cannot be changed",
    );

    const changedSize = structuredClone(defaultProductRegistry);
    changedSize.products[0].configuration.sizes[0].key = "different-size";
    expect(() => parseProductRegistry(changedSize)).toThrow(
      "Size structure cannot be changed",
    );
  });

  it("uses registry people and urgent fee policies in customer prices", () => {
    const input = structuredClone(defaultProductRegistry);
    input.pricing.peoplePetsFeesExGstCents = [4_500, 6_000, 8_500, 11_000, 13_000];
    input.pricing.urgentServiceFeesInclGstCents = [8_500, 7_000, 6_000, 5_000];
    synchronizeNewZealandPriceBook(input);
    const registry = parseProductRegistry(input);
    const schema = schemaFromRegistry(registry, "digital-oil-painting-canvas")!;

    expect(
      quoteConfiguration(
        schema,
        { sizeKey: "a4", peoplePets: 1 },
        { peoplePetsPricing: registry.pricing },
      ).subtotalExGstCents,
    ).toBe(11_000);
    expect(
      getUrgentService(
        "2026-08-03",
        "2026-08-04",
        registry.pricing.urgentServiceFeesInclGstCents,
      ).feeInclGstCents,
    ).toBe(8_500);
  });

  it("rejects unsafe prices and an inactive featured product", () => {
    const unsafe = structuredClone(defaultProductRegistry);
    unsafe.products[0].configuration.sizes[0].priceExGstCents = -1;
    expect(() => parseProductRegistry(unsafe)).toThrow("non-negative integer cents");

    const inactiveFeatured = structuredClone(defaultProductRegistry);
    inactiveFeatured.products[0].active = false;
    inactiveFeatured.products[0].featured = true;
    expect(() => parseProductRegistry(inactiveFeatured)).toThrow(
      "Featured products must be active",
    );
  });

  it("upgrades the legacy Grave Cover registry orientation without mutating its source", () => {
    const legacy = structuredClone(defaultProductRegistry);
    const graveCover = legacy.products.find((product) => product.key === "grave-cover")!;
    graveCover.configuration.orientationMode = "fixed";
    graveCover.configuration.defaultOrientation = "portrait";

    const parsed = parseProductRegistry(legacy);
    const parsedGraveCover = parsed.products.find((product) => product.key === "grave-cover")!;
    expect(parsedGraveCover.configuration.orientationMode).toBe("none");
    expect(parsedGraveCover.configuration).not.toHaveProperty("defaultOrientation");
    expect(graveCover.configuration.orientationMode).toBe("fixed");
    expect(graveCover.configuration.defaultOrientation).toBe("portrait");
  });

  it("upgrades a legacy Custom Canvas registry so photo 21 is charged", () => {
    const legacy = structuredClone(defaultProductRegistry);
    const customCanvas = legacy.products.find((product) => product.key === "custom-themed-canvas")!;
    delete customCanvas.configuration.extraPhotoPriceExGstCents;

    const parsed = parseProductRegistry(legacy);
    const parsedCustomCanvas = parsed.products.find((product) => product.key === "custom-themed-canvas")!;

    expect(parsedCustomCanvas.configuration.extraPhotoPriceExGstCents).toBe(500);
    expect(customCanvas.configuration.extraPhotoPriceExGstCents).toBeUndefined();
  });
});
