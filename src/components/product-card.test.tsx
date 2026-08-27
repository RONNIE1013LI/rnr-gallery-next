import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as analytics from "@/domain/analytics/client";
import { products } from "@/domain/catalogue/products";
import { ProductCard } from "./product-card";
import { CataloguePage } from "./catalogue-page";
import styles from "./storefront.module.css";

vi.mock("@/domain/analytics/client", () => ({
  emitAnalyticsEvent: vi.fn(() => true),
}));

beforeEach(() => {
  vi.mocked(analytics.emitAnalyticsEvent).mockClear();
});

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
    expect(screen.getByText("From NZ$120.75 incl GST")).toBeVisible();
    expect(screen.queryByText(/excl GST/i)).not.toBeInTheDocument();
  });

  it("renders a fixed Australian price and AU route without NZ fallback", () => {
    const product = products[1];
    render(
      <ProductCard
        product={product}
        market="AU"
        priceInclTaxCents={32_000}
      />,
    );

    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `/au/products/${product.slug}/configure`,
    );
    expect(screen.getByText("From A$320.00 AUD")).toBeVisible();
    expect(screen.queryByText(/NZ\$/)).not.toBeInTheDocument();
  });
});

describe("CataloguePage image loading", () => {
  it("tracks the visible item list and the selected product without delaying navigation", async () => {
    render(
      <CataloguePage
        eyebrow="Products"
        title="Shop"
        description="Choose a format"
        path="/shop"
        products={products.slice(0, 2)}
      />,
    );

    await waitFor(() => expect(analytics.emitAnalyticsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "view_item_list",
        item_list_id: "nz:/shop",
        item_list_name: "Shop",
      }),
    ));

    const firstProductLink = screen.getAllByRole("link")
      .find((link) => link.getAttribute("href")?.includes("/configure"));
    expect(firstProductLink).toBeDefined();
    fireEvent.click(firstProductLink!);
    expect(analytics.emitAnalyticsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "select_item",
        item_list_id: "nz:/shop",
        item_list_name: "Shop",
      }),
    );
  });

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

  it("publishes a breadcrumb canonical for the current category", () => {
    const { container } = render(
      <CataloguePage
        eyebrow="Canvas"
        title="Custom canvas"
        description="Choose a format"
        path="/canvas"
        breadcrumbLabel="Canvas"
        products={products.slice(0, 2)}
      />,
    );

    expect(JSON.parse(container.querySelector("#rnr-catalogue-breadcrumbs")?.textContent ?? "{}"))
      .toMatchObject({
        "@type": "BreadcrumbList",
        itemListElement: [
          { position: 1, name: "Home", item: "https://rrgallery.co.nz/" },
          { position: 2, name: "Canvas", item: "https://rrgallery.co.nz/canvas" },
        ],
      });
  });

});
