import { describe, expect, it, vi } from "vitest";
import {
  defaultProductRegistry,
  getRegistryProductBySlug,
} from "@/domain/catalogue/product-registry";
import {
  ProductRegistryConflictError,
  createProductRegistryService,
} from "./product-registry-service";

const actor = Object.freeze({ userId: "admin-1", email: "owner@example.test" });

function memoryRepository(initial?: Readonly<{ revision: number; snapshot: unknown }>) {
  let state = initial ?? null;
  return {
    read: vi.fn(async () => state),
    publish: vi.fn(async (input: Readonly<{
      expectedRevision: number;
      snapshot: unknown;
    }>) => {
      if ((state?.revision ?? 0) !== input.expectedRevision) {
        return { result: "conflict" as const };
      }
      state = { revision: input.expectedRevision + 1, snapshot: input.snapshot };
      return {
        result: "published" as const,
        revision: state.revision,
        snapshot: state.snapshot,
      };
    }),
  };
}

describe("product registry administration", () => {
  it("uses the code registry as revision zero before the first publication", async () => {
    const service = createProductRegistryService(memoryRepository());

    const current = await service.current();

    expect(current.revision).toBe(0);
    expect(current.registry).toEqual(defaultProductRegistry);
  });

  it("publishes a complete validated snapshot from a product patch", async () => {
    const repository = memoryRepository();
    const service = createProductRegistryService(repository);

    const result = await service.publishProduct(actor, {
      productKey: "digital-oil-painting-canvas",
      expectedRevision: 0,
      idempotencyKey: "product-publish-0001",
      title: "Digital Oil Painting Canvas",
      summary: "A painterly portrait created from your source photos.",
      imageSrc: "/media/home/digital-oil-pet.webp",
      imageAlt: "Custom digital oil painting canvas portrait",
      active: true,
      featured: true,
      sizes: [
        { key: "a4", label: "A4 — 29.7 × 21 cm", priceExGstCents: 7_100 },
        { key: "a3", label: "A3 — 42 × 29.7 cm", priceExGstCents: 7_800 },
        { key: "a2", label: "A2 — 59.4 × 42 cm", priceExGstCents: 9_800 },
        { key: "a1", label: "A1 — 84.1 × 59.4 cm", priceExGstCents: 14_800 },
        { key: "a0", label: "A0 — 118.9 × 84.1 cm", priceExGstCents: 28_000 },
      ],
      includedPhotos: 0,
      extraPhotoPriceExGstCents: null,
      extraBackgroundRemovalFeeInclGstCents: null,
    });

    expect(result.revision).toBe(1);
    expect(
      getRegistryProductBySlug(
        result.registry,
        "digital-oil-painting-canvas",
      )?.startingPriceExGstCents,
    ).toBe(11_100);
    expect(
      result.registry.markets.NZ.products
        .find((product) => product.productKey === "digital-oil-painting-canvas")
        ?.sizes.find((size) => size.sizeKey === "a4")
        ?.amountInclTaxCents,
    ).toBe(8_165);
    expect(repository.publish).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 0,
      action: "product.registry.product.published",
      resourceId: "digital-oil-painting-canvas",
    }));
  });

  it("rejects a stale editor before it can overwrite a newer revision", async () => {
    const repository = memoryRepository({ revision: 3, snapshot: defaultProductRegistry });
    const service = createProductRegistryService(repository);

    await expect(service.publishPricing(actor, {
      expectedRevision: 2,
      idempotencyKey: "pricing-publish-0001",
      peoplePetsFeesExGstCents: [4_000, 6_000, 8_500, 11_000, 13_000],
      additionalPeoplePetsEachExGstCents: 2_500,
      urgentServiceFeesInclGstCents: [8_000, 7_000, 6_000, 5_000],
    })).rejects.toBeInstanceOf(ProductRegistryConflictError);
    expect(repository.publish).toHaveBeenCalledOnce();
  });

  it("returns the recorded revision when an idempotent publication is retried", async () => {
    const repository = {
      read: vi.fn().mockResolvedValue({ revision: 1, snapshot: defaultProductRegistry }),
      publish: vi.fn().mockResolvedValue({
        result: "duplicate" as const,
        revision: 1,
        snapshot: defaultProductRegistry,
      }),
    };
    const service = createProductRegistryService(repository);

    await expect(service.publishPricing(actor, {
      expectedRevision: 0,
      idempotencyKey: "pricing-publish-retry",
      peoplePetsFeesExGstCents: [4_000, 6_000, 8_500, 11_000, 13_000],
      additionalPeoplePetsEachExGstCents: 2_500,
      urgentServiceFeesInclGstCents: [8_000, 7_000, 6_000, 5_000],
    })).resolves.toMatchObject({ result: "duplicate", revision: 1 });
  });

  it("uses a published store-wide fee policy in the next registry revision", async () => {
    const service = createProductRegistryService(memoryRepository());

    const result = await service.publishPricing(actor, {
      expectedRevision: 0,
      idempotencyKey: "pricing-publish-0002",
      peoplePetsFeesExGstCents: [4_500, 6_500, 9_000, 11_500, 13_500],
      additionalPeoplePetsEachExGstCents: 2_750,
      urgentServiceFeesInclGstCents: [8_500, 7_500, 6_500, 5_500],
    });

    expect(result.registry.pricing).toEqual({
      peoplePetsFeesExGstCents: [4_500, 6_500, 9_000, 11_500, 13_500],
      additionalPeoplePetsEachExGstCents: 2_750,
      urgentServiceFeesInclGstCents: [8_500, 7_500, 6_500, 5_500],
    });
  });

  it("refuses to publish a product image that is missing from managed storefront media", async () => {
    const repository = memoryRepository();
    const assetExists = vi.fn().mockResolvedValue(false);
    const service = createProductRegistryService(repository, { assetExists });

    await expect(service.publishProduct(actor, {
      productKey: "digital-oil-painting-canvas",
      expectedRevision: 0,
      idempotencyKey: "product-missing-media",
      title: "Digital Oil Painting Canvas",
      summary: "A painterly portrait created from your source photos.",
      imageSrc: "/media/home/missing.webp",
      imageAlt: "Custom digital oil painting canvas portrait",
      active: true,
      featured: true,
      sizes: defaultProductRegistry.products[0].configuration.sizes,
      includedPhotos: 0,
      extraPhotoPriceExGstCents: null,
      extraBackgroundRemovalFeeInclGstCents: null,
    })).rejects.toThrow("Product image was not found in Media.");
    expect(assetExists).toHaveBeenCalledWith("/media/home/missing.webp");
    expect(repository.publish).not.toHaveBeenCalled();
  });
});
