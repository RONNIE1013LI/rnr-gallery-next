import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { products } from "@/domain/catalogue/products";
import { ProductCard } from "./product-card";

describe("ProductCard", () => {
  it("presents one clear product destination and starting price", () => {
    const product = products[1];
    render(<ProductCard product={product} />);

    expect(screen.getByRole("heading", { name: product.title })).toBeVisible();
    expect(screen.getByRole("img", { name: product.image.alt })).toBeVisible();
    expect(screen.getByRole("link", { name: /view product/i })).toHaveAttribute(
      "href",
      `/products/${product.slug}`,
    );
    expect(screen.getByText("From $105.00 + GST")).toBeVisible();
  });
});
