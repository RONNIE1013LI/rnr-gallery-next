import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { products } from "@/domain/catalogue/products";
import { ProductCard } from "./product-card";
import { CataloguePage } from "./catalogue-page";
import styles from "./storefront.module.css";

describe("ProductCard", () => {
  it("presents one clear product destination and starting price", () => {
    const product = products[1];
    render(<ProductCard product={product} priority />);

    const productImage = screen.getByRole("img", { name: product.image.alt });
    const productLink = screen.getByRole("link");

    expect(screen.getByRole("heading", { name: product.title })).toBeVisible();
    expect(productImage)
      .toHaveAttribute("fetchpriority", "high");
    expect(productImage).toHaveAttribute("loading", "eager");
    expect(productImage).toHaveAttribute(
      "sizes",
      "(max-width: 560px) calc(100vw - 2.5rem - 2px), (max-width: 650px) calc(92vw - 2px), (max-width: 1100px) calc(44.75vw - 2px), (max-width: 1363px) calc(29vw - 2px), (max-width: 1567px) calc(21.125vw - 2px), 328px",
    );
    expect(productLink).toContainElement(productImage);
    expect(productLink).toContainElement(screen.getByRole("heading", { name: product.title }));
    expect(productLink).toHaveAttribute(
      "href",
      `/products/${product.slug}/configure`,
    );
    expect(screen.getByText("Create Your Artwork")).toHaveClass(styles.primaryButton);
    expect(screen.getByText("From $105.00 + GST")).toBeVisible();
  });
});

describe("CataloguePage image loading", () => {
  it("eager-loads only the first Shop product image", () => {
    render(
      <CataloguePage
        eyebrow="Products"
        title="Shop"
        description="Choose a format"
        products={products.slice(0, 4)}
      />,
    );

    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(4);
    expect(images[0]).toHaveAttribute("fetchpriority", "high");
    expect(images[0]).toHaveAttribute("loading", "eager");
    for (const image of images.slice(1)) {
      expect(image).not.toHaveAttribute("fetchpriority", "high");
      expect(image).not.toHaveAttribute("loading", "eager");
    }
  });
});
