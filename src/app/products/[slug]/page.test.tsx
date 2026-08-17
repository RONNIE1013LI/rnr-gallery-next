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
    const breadcrumbs = container.querySelector("#rnr-product-breadcrumbs");
    expect(structuredData).toHaveAttribute("type", "application/ld+json");
    const parsedProduct = JSON.parse(structuredData?.textContent ?? "{}");
    expect(parsedProduct).toMatchObject({
      "@type": "Product",
      name: "Digital Oil Painting Canvas",
      offers: {
        price: "120.75",
        priceCurrency: "NZD",
        availability: "https://schema.org/InStock",
      },
    });
    expect(screen.getByText("From NZ$120.75 incl GST")).toBeVisible();
    expect(screen.queryByText(/excl GST/i)).not.toBeInTheDocument();
    expect(JSON.parse(breadcrumbs?.textContent ?? "{}")).toMatchObject({
      "@type": "BreadcrumbList",
      itemListElement: [
        { position: 1, name: "Home", item: "https://rrgallery.co.nz/" },
        { position: 2, name: "Shop", item: "https://rrgallery.co.nz/shop" },
        {
          position: 3,
          name: "Digital Oil Painting Canvas",
          item: "https://rrgallery.co.nz/products/digital-oil-painting-canvas",
        },
      ],
    });

    render(<ProductPageContent product={product} reviewPage={2} selection={null} />);
    expect(screen.getByText("Harris Nanoz")).toBeInTheDocument();
  });

  it("keeps Australian product links, prices and structured data in AUD", () => {
    const product = getProductBySlug("roll-up-banner")!;
    const { container } = render(
      <ProductPageContent
        product={product}
        selection={null}
        market="AU"
        priceInclTaxCents={32_000}
      />,
    );

    expect(screen.getByText("From A$320.00 AUD")).toBeVisible();
    expect(screen.getByRole("link", { name: "Create your artwork" })).toHaveAttribute(
      "href",
      "/au/products/roll-up-banner/configure",
    );
    const data = JSON.parse(container.querySelector("#rnr-product-data")?.textContent ?? "{}");
    expect(data.offers).toMatchObject({
      price: "320.00",
      priceCurrency: "AUD",
      url: "https://rrgallery.co.nz/au/products/roll-up-banner",
    });
    expect(screen.queryByText(/NZ\$/)).not.toBeInTheDocument();
  });

  it.each([
    ["NZ", 35_999, "NZD", "359.99", "From NZ$359.99 incl GST"],
    ["AU", 33_999, "AUD", "339.99", "From A$339.99 AUD"],
  ] as const)(
    "publishes the Banner Bundle %s starting amount in Product JSON-LD",
    (market, priceInclTaxCents, currency, price, visiblePrice) => {
      const product = getProductBySlug("banner-bundle")!;
      const { container } = render(
        <ProductPageContent
          product={product}
          selection={null}
          market={market}
          priceInclTaxCents={priceInclTaxCents}
        />,
      );

      expect(screen.getByText(visiblePrice)).toBeVisible();
      expect(JSON.parse(
        container.querySelector("#rnr-product-data")?.textContent ?? "{}",
      )).toMatchObject({
        "@type": "Product",
        name: "Banner Bundle",
        image: ["https://rrgallery.co.nz/media/products/banner-bundle.png"],
        offers: {
          price,
          priceCurrency: currency,
        },
      });
    },
  );

  it("preserves a selected size when opening the configurator", () => {
    const product = getProductBySlug("photo-print-canvas")!;
    const { container } = render(
      <ProductPageContent
        product={product}
        selection={null}
        market="AU"
        priceInclTaxCents={10_999}
        selectedSizeKey="a2"
      />,
    );

    expect(screen.getByText("From A$109.99 AUD")).toBeVisible();
    expect(screen.getByRole("link", { name: "Create your artwork" })).toHaveAttribute(
      "href",
      "/au/products/photo-print-canvas/configure?size=a2",
    );
    const data = JSON.parse(container.querySelector("#rnr-product-data")?.textContent ?? "{}");
    expect(data.offers).toMatchObject({
      price: "109.99",
      priceCurrency: "AUD",
      url: "https://rrgallery.co.nz/au/products/photo-print-canvas?size=a2",
    });
  });
});
