import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultProductRegistry,
  parseProductRegistry,
} from "@/domain/catalogue/product-registry";
import AustraliaShopPage, { generateMetadata } from "./page";

const state = vi.hoisted(() => ({ registry: undefined as unknown }));

vi.mock("@/server/admin/product-registry-runtime", () => ({
  getSafePublicProductRegistry: async () => ({ registry: state.registry }),
}));

function enabledAustraliaRegistry() {
  const registry = structuredClone(defaultProductRegistry);
  for (const product of registry.markets.AU.products) {
    for (const size of product.sizes) size.amountInclTaxCents = 40_000;
    for (const charge of product.charges) charge.amountInclTaxCents = 3_000;
  }
  const rollUp = registry.markets.AU.products.find(
    (product) => product.productKey === "roll-up-banner",
  )!;
  rollUp.sizes.find((size) => size.sizeKey === "standard")!.amountInclTaxCents = 32_000;
  for (const fee of registry.markets.AU.peoplePets.fees) fee.amountInclTaxCents = fee.count * 6_000;
  registry.markets.AU.peoplePets.additionalEachInclTaxCents = 4_000;
  for (const fee of registry.markets.AU.urgentServiceFees) fee.amountInclTaxCents = 10_000;
  for (const shipping of registry.markets.AU.shippingMethods) shipping.amountInclTaxCents = 4_500;
  registry.markets.AU.enabled = true;
  return parseProductRegistry(registry);
}

describe("Australia shop", () => {
  beforeEach(() => {
    state.registry = defaultProductRegistry;
  });

  it("keeps the catalogue unavailable while AU pricing is disabled", async () => {
    render(await AustraliaShopPage());

    expect(screen.getByRole("heading", {
      name: "Australia ordering is not available yet.",
    })).toBeVisible();
    expect(await generateMetadata()).toMatchObject({
      robots: { index: false, follow: false },
    });
  });

  it("shows AUD products and sends product clicks directly to configuration", async () => {
    state.registry = enabledAustraliaRegistry();
    render(await AustraliaShopPage());

    expect(screen.getByRole("heading", { name: "Custom artwork for Australia." })).toBeVisible();
    expect(screen.getByText("From A$320.00 AUD")).toBeVisible();
    expect(screen.queryByText(/NZ\$/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Roll-Up Banner" }).closest("a"))
      .toHaveAttribute("href", "/au/products/roll-up-banner/configure");
    expect(await generateMetadata()).toMatchObject({
      alternates: {
        canonical: "https://rnrgallery.com/au/shop",
        languages: {
          "en-NZ": "https://rnrgallery.com/shop",
          "en-AU": "https://rnrgallery.com/au/shop",
          "x-default": "https://rnrgallery.com/shop",
        },
      },
      robots: { index: true, follow: true },
    });
  });
});
