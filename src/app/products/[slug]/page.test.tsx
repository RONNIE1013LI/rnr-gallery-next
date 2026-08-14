import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getProductBySlug } from "@/domain/catalogue/products";
import { ProductPageContent } from "./page-content";

describe("ProductPageContent", () => {
  it("shows a validated inspiration and preserves it in the create link", () => {
    const product = getProductBySlug("digital-oil-painting-canvas")!;
    const designId = "a".repeat(64);
    render(<ProductPageContent product={product} selection={{
      id: designId,
      title: "In loving memory",
      altText: "Memorial floral canvas",
      imageUrl: `/gallery-images/${designId}?v=${"b".repeat(64)}`,
      contentHash: "b".repeat(64),
      productSlug: "digital-oil-painting-canvas",
      width: 1200,
      height: 1600,
    }} />);

    expect(screen.getByText("Selected design inspiration")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Memorial floral canvas" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create your artwork" }))
      .toHaveAttribute("href", `/products/digital-oil-painting-canvas/configure?design=${designId}`);
  });

  it("shows a compact Facebook recommendations section below the product", () => {
    const product = getProductBySlug("digital-oil-painting-canvas")!;
    const { container } = render(<ProductPageContent product={product} selection={null} />);

    const reviews = screen.getByRole("region", {
      name: "Facebook recommendations",
    });
    expect(within(reviews).getAllByRole("listitem")).toHaveLength(2);
    expect(
      within(reviews).getByRole("link", { name: "Next recommendations" }),
    ).toHaveAttribute(
      "href",
      "/products/digital-oil-painting-canvas?reviews=2#facebook-recommendations",
    );
    const structuredData = container.querySelector("#rnr-product-data");
    expect(structuredData).toHaveAttribute("type", "application/ld+json");
    expect(JSON.parse(structuredData?.textContent ?? "{}")).toMatchObject({
      "@type": "Product",
      name: "Digital Oil Painting Canvas",
      offers: { priceCurrency: "NZD", availability: "https://schema.org/InStock" },
    });

    render(<ProductPageContent product={product} reviewPage={2} selection={null} />);
    expect(screen.getByText("Harris Nanoz")).toBeInTheDocument();
  });
});
