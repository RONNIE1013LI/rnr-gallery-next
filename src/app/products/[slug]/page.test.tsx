import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultProductRegistry,
  parseProductRegistry,
} from "@/domain/catalogue/product-registry";
import { getProductBySlug } from "@/domain/catalogue/products";
import AustraliaProductPage from "@/app/au/products/[slug]/page";
import ProductPage, { ProductPageContent } from "./page-content";

const state = vi.hoisted(() => ({
  registry: undefined as unknown,
  selection: null as unknown,
  track: vi.fn(),
}));

vi.mock("@/server/admin/product-registry-runtime", () => ({
  getSafePublicProductRegistry: async () => ({ registry: state.registry }),
}));
vi.mock("@/server/gallery/gallery-runtime", () => ({
  getGalleryRuntime: () => ({
    selectionService: { resolve: vi.fn().mockImplementation(async () => state.selection) },
  }),
}));
vi.mock("@/components/analytics-event-tracker", () => ({
  AnalyticsEventTracker: (props: unknown) => {
    state.track(props);
    return null;
  },
}));

function enabledAustraliaRegistry() {
  const registry = structuredClone(defaultProductRegistry);
  for (const product of registry.markets.AU.products) {
    for (const size of product.sizes) size.amountInclTaxCents ??= 40_000;
    for (const charge of product.charges) charge.amountInclTaxCents ??= 2_000;
  }
  for (const fee of registry.markets.AU.peoplePets.fees) {
    fee.amountInclTaxCents ??= 5_000;
  }
  registry.markets.AU.peoplePets.additionalEachInclTaxCents ??= 3_000;
  for (const fee of registry.markets.AU.urgentServiceFees) {
    fee.amountInclTaxCents ??= 9_000;
  }
  for (const shipping of registry.markets.AU.shippingMethods) {
    if (shipping.source === "fixed") shipping.amountInclTaxCents ??= 3_500;
  }
  registry.markets.AU.enabled = true;
  return parseProductRegistry(registry);
}

const bundleProps = {
  params: Promise.resolve({ slug: "banner-bundle" }),
  searchParams: Promise.resolve({}),
};

describe("ProductPageContent", () => {
  beforeEach(() => {
    state.registry = defaultProductRegistry;
    state.selection = null;
    state.track.mockClear();
  });

  it("tracks the default NZ product quote in NZD without selected-design details", async () => {
    const designId = "a".repeat(64);
    state.selection = {
      id: designId,
      title: "Private memorial wording",
      altText: "Private selected design alt text",
      imageUrl: `/gallery-images/${designId}?v=${"b".repeat(64)}`,
      contentHash: "b".repeat(64),
      productSlug: "digital-oil-painting-canvas",
      width: 1200,
      height: 1600,
    };

    render(await ProductPage({
      params: Promise.resolve({ slug: "digital-oil-painting-canvas" }),
      searchParams: Promise.resolve({ design: designId }),
    }));

    expect(state.track).toHaveBeenCalledWith({
      event: {
        event: "view_item",
        currency: "NZD",
        value: 105,
        items: [{
          item_id: "digital-oil-painting-canvas",
          item_name: "Digital Oil Painting Canvas",
          item_category: "canvas",
          item_variant: "a4",
          price: 105,
          quantity: 1,
        }],
      },
      scopeKey: "NZ:digital-oil-painting-canvas:a4",
    });
    const payload = JSON.stringify(state.track.mock.calls);
    expect(payload).not.toContain("Private memorial wording");
    expect(payload).not.toContain("gallery-images");
  });
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
        { position: 1, name: "Home", item: "https://rnrgallery.com/" },
        { position: 2, name: "Shop", item: "https://rnrgallery.com/shop" },
        {
          position: 3,
          name: "Digital Oil Painting Canvas",
          item: "https://rnrgallery.com/products/digital-oil-painting-canvas",
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
      url: "https://rnrgallery.com/au/products/roll-up-banner",
    });
    expect(screen.queryByText(/NZ\$/)).not.toBeInTheDocument();
  });

  it("resolves the NZ Banner Bundle JSON-LD starting offer from the runtime registry", async () => {
    const { container } = render(await ProductPage(bundleProps));

    expect(JSON.parse(
      container.querySelector("#rnr-product-data")?.textContent ?? "{}",
    )).toMatchObject({
      "@type": "Product",
      name: "Banner Bundle",
      image: ["https://rnrgallery.com/media/products/banner-bundle.webp"],
      offers: {
        price: "359.99",
        priceCurrency: "NZD",
      },
    });
  });

  it("resolves the AU Banner Bundle JSON-LD starting offer from the runtime registry", async () => {
    state.registry = enabledAustraliaRegistry();

    const { container } = render(await AustraliaProductPage(bundleProps));

    expect(JSON.parse(
      container.querySelector("#rnr-product-data")?.textContent ?? "{}",
    )).toMatchObject({
      "@type": "Product",
      name: "Banner Bundle",
      image: ["https://rnrgallery.com/media/products/banner-bundle.webp"],
      offers: {
        price: "339.99",
        priceCurrency: "AUD",
      },
    });
  });

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
      url: "https://rnrgallery.com/au/products/photo-print-canvas?size=a2",
    });
  });
});
