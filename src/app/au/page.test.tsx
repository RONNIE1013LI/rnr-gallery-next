import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultProductRegistry,
  parseProductRegistry,
} from "@/domain/catalogue/product-registry";
import AustraliaPage, { generateMetadata } from "./page";

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
  for (const fee of registry.markets.AU.peoplePets.fees) {
    fee.amountInclTaxCents = fee.count * 6_000;
  }
  registry.markets.AU.peoplePets.additionalEachInclTaxCents = 4_000;
  for (const fee of registry.markets.AU.urgentServiceFees) fee.amountInclTaxCents = 10_000;
  for (const shipping of registry.markets.AU.shippingMethods) shipping.amountInclTaxCents = 4_500;
  registry.markets.AU.enabled = true;
  return parseProductRegistry(registry);
}

describe("Australia storefront", () => {
  beforeEach(() => {
    state.registry = defaultProductRegistry;
  });

  it("keeps the stable AU URL closed and noindex while pricing is disabled", async () => {
    render(await AustraliaPage());

    expect(screen.getByRole("heading", {
      name: "Australia ordering is not available yet.",
    })).toBeVisible();
    expect(screen.queryByText(/A\$\d/)).not.toBeInTheDocument();
    expect(await generateMetadata()).toMatchObject({
      robots: { index: false, follow: false },
    });
  });

  it("publishes only explicit AUD prices after the complete book is enabled", async () => {
    state.registry = enabledAustraliaRegistry();
    render(await AustraliaPage());

    expect(screen.getByRole("heading", { name: "Custom artwork for Australia." })).toBeVisible();
    expect(screen.getByText("From A$320.00 AUD")).toBeVisible();
    expect(screen.queryByText(/NZ\$/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Roll-Up Banner/i })).toHaveAttribute(
      "href",
      "/au/products/roll-up-banner",
    );
    expect(await generateMetadata()).toMatchObject({
      alternates: { canonical: "https://rrgallery.co.nz/au" },
      robots: { index: true, follow: true },
    });
  });
});
