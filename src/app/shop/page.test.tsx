import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { synchronizeNewZealandPriceBook } from "@/domain/catalogue/market-price-book";
import ShopPage from "./page";

const state = vi.hoisted(() => ({ registry: undefined as unknown }));

vi.mock("@/server/admin/product-registry-runtime", () => ({
  getSafePublicProductRegistry: async () => ({ registry: state.registry }),
}));

describe("Shop page", () => {
  beforeEach(() => {
    state.registry = defaultProductRegistry;
  });

  it("lists Banner Bundle with its supplied product image and exact NZ price", async () => {
    render(await ShopPage());

    const heading = screen.getByRole("heading", { name: "Banner Bundle" });
    const card = heading.closest("article");
    expect(card).not.toBeNull();
    const image = within(card!).getByRole("img", {
      name: "A roll-up banner and matching wall banner prepared as a personalised event package",
    });
    expect(new URL(image.getAttribute("src")!, "https://rrgallery.co.nz")
      .searchParams.get("url")).toBe("/media/products/banner-bundle.webp");
    expect(within(card!).getByText("From NZ$359.99 incl GST")).toBeVisible();
  });

  it("keeps normal products on their existing lowest-size catalogue price", async () => {
    const registry = structuredClone(defaultProductRegistry);
    const product = registry.products.find(
      (candidate) => candidate.key === "digital-oil-painting-canvas",
    )!;
    product.configuration.sizes.find((size) => size.key === "a3")!
      .priceExGstCents = 1_000;
    synchronizeNewZealandPriceBook(registry);
    state.registry = registry;

    render(await ShopPage());

    const card = screen.getByRole("heading", {
      name: "Digital Oil Painting Canvas",
    }).closest("article");
    expect(within(card!).getByText("From NZ$57.50 incl GST")).toBeVisible();
  });
});
