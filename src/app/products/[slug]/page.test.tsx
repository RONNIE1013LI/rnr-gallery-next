import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getProductBySlug } from "@/domain/catalogue/products";
import { ProductPageContent } from "./page";

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
});
