import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  defaultProductRegistry,
  parseProductRegistry,
} from "@/domain/catalogue/product-registry";
import AustraliaCanvasPage, { generateMetadata as canvasMetadata } from "./canvas/page";
import AustraliaBannersPage, { generateMetadata as bannersMetadata } from "./banners/page";

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
  for (const fee of registry.markets.AU.peoplePets.fees) fee.amountInclTaxCents = fee.count * 6_000;
  registry.markets.AU.peoplePets.additionalEachInclTaxCents = 4_000;
  for (const fee of registry.markets.AU.urgentServiceFees) fee.amountInclTaxCents = 10_000;
  for (const shipping of registry.markets.AU.shippingMethods) shipping.amountInclTaxCents = 4_500;
  registry.markets.AU.enabled = true;
  return parseProductRegistry(registry);
}

describe("Australia category pages", () => {
  it("publishes the Canvas category in AUD with direct configuration links", async () => {
    state.registry = enabledAustraliaRegistry();
    render(await AustraliaCanvasPage());

    expect(screen.getByRole("heading", { name: "Personalised canvas made from your photos." }))
      .toBeVisible();
    expect(screen.getAllByText("From A$400.00 AUD").length).toBeGreaterThan(0);
    expect(screen.queryByText(/NZ\$/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Photo Print Canvas" }).closest("a"))
      .toHaveAttribute("href", "/au/products/photo-print-canvas/configure");
    expect(await canvasMetadata()).toMatchObject({
      alternates: { canonical: "https://rrgallery.co.nz/au/canvas" },
    });
  });

  it("publishes the Banners category in AUD with direct configuration links", async () => {
    state.registry = enabledAustraliaRegistry();
    render(await AustraliaBannersPage());

    expect(screen.getByRole("heading", { name: "Custom banners made for your occasion." }))
      .toBeVisible();
    expect(screen.getAllByText("From A$400.00 AUD").length).toBeGreaterThan(0);
    expect(screen.queryByText(/NZ\$/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Roll-Up Banner" }).closest("a"))
      .toHaveAttribute("href", "/au/products/roll-up-banner/configure");
    expect(await bannersMetadata()).toMatchObject({
      alternates: { canonical: "https://rrgallery.co.nz/au/banners" },
    });
  });
});
