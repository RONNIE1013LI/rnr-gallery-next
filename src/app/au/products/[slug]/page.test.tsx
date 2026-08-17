import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultProductRegistry,
  parseProductRegistry,
} from "@/domain/catalogue/product-registry";
import AustraliaProductPage from "./page";

const state = vi.hoisted(() => ({
  registry: undefined as unknown,
  selection: null as unknown,
  track: vi.fn(),
}));

vi.mock("@/server/admin/product-registry-runtime", () => ({
  getSafePublicProductRegistry: async () => ({ registry: state.registry }),
}));
vi.mock("@/server/gallery/gallery-runtime", () => ({
  getGalleryRuntime: () => ({
    selectionService: { resolve: vi.fn().mockImplementation(async () => state.selection) },
  }),
}));
vi.mock("@/components/analytics-event-tracker", () => ({
  AnalyticsEventTracker: (props: unknown) => {
    state.track(props);
    return null;
  },
}));

function enabledAustraliaRegistry() {
  const registry = structuredClone(defaultProductRegistry);
  for (const product of registry.markets.AU.products) {
    for (const size of product.sizes) size.amountInclTaxCents = 40_000;
    for (const charge of product.charges) charge.amountInclTaxCents = 2_000;
  }
  for (const fee of registry.markets.AU.peoplePets.fees) {
    fee.amountInclTaxCents = 5_000;
  }
  registry.markets.AU.peoplePets.additionalEachInclTaxCents = 3_000;
  for (const fee of registry.markets.AU.urgentServiceFees) {
    fee.amountInclTaxCents = 9_000;
  }
  for (const shipping of registry.markets.AU.shippingMethods) {
    if (shipping.source === "fixed") shipping.amountInclTaxCents = 3_500;
  }
  const canvas = registry.markets.AU.products.find(
    (product) => product.productKey === "digital-oil-painting-canvas",
  )!;
  canvas.sizes.find((size) => size.sizeKey === "a4")!.amountInclTaxCents = 41_234;
  registry.markets.AU.peoplePets.fees.find((fee) => fee.count === 1)!
    .amountInclTaxCents = 6_789;
  registry.markets.AU.enabled = true;
  return parseProductRegistry(registry);
}

describe("AustraliaProductPage analytics", () => {
  beforeEach(() => {
    state.registry = enabledAustraliaRegistry();
    state.track.mockClear();
    const designId = "c".repeat(64);
    state.selection = {
      id: designId,
      title: "Private Australian design title",
      altText: "Private Australian design alt text",
      imageUrl: `/gallery-images/${designId}?v=${"d".repeat(64)}`,
      contentHash: "d".repeat(64),
      productSlug: "digital-oil-painting-canvas",
      width: 1200,
      height: 1600,
    };
  });

  it("tracks the fixed AU price-book quote in AUD without conversion or design details", async () => {
    render(await AustraliaProductPage({
      params: Promise.resolve({ slug: "digital-oil-painting-canvas" }),
      searchParams: Promise.resolve({ design: "c".repeat(64) }),
    }));

    expect(screen.getByText("From A$480.23 AUD")).toBeVisible();
    expect(state.track).toHaveBeenCalledWith({
      event: {
        event: "view_item",
        currency: "AUD",
        value: 480.23,
        items: [{
          item_id: "digital-oil-painting-canvas",
          item_name: "Digital Oil Painting Canvas",
          item_category: "canvas",
          item_variant: "a4",
          price: 480.23,
          quantity: 1,
        }],
      },
      scopeKey: "AU:digital-oil-painting-canvas:a4",
    });
    const payload = JSON.stringify(state.track.mock.calls);
    expect(payload).not.toContain("Private Australian design title");
    expect(payload).not.toContain("gallery-images");
  });
});
