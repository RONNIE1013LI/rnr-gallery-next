import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultProductRegistry,
  parseProductRegistry,
} from "@/domain/catalogue/product-registry";
import DesignDetailPage, { generateMetadata, revalidate } from "./page";

const { findByPublicSlug, list, notFound } = vi.hoisted(() => ({
  findByPublicSlug: vi.fn(),
  list: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));
const state = vi.hoisted(() => ({
  registry: undefined as unknown,
  market: "NZ",
  resolvedMarket: null as string | null,
}));

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/server/gallery/gallery-runtime", () => ({
  getGalleryRuntime: () => ({ publicService: { findByPublicSlug, list } }),
}));
vi.mock("@/server/admin/product-registry-runtime", () => ({
  getSafePublicProductRegistry: async () => ({ registry: state.registry }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: state.market }) }),
  headers: async () => ({ get: () => state.resolvedMarket }),
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
  for (const fee of registry.markets.AU.peoplePets.fees) fee.amountInclTaxCents = fee.count * 6_000;
  registry.markets.AU.peoplePets.additionalEachInclTaxCents = 4_000;
  for (const fee of registry.markets.AU.urgentServiceFees) fee.amountInclTaxCents = 10_000;
  for (const shipping of registry.markets.AU.shippingMethods) shipping.amountInclTaxCents = 4_500;
  registry.markets.AU.enabled = true;
  return parseProductRegistry(registry);
}

const designId = `a1b2c3d4${"a".repeat(56)}`;
const design = {
  id: designId,
  productTypeSlug: "roll-up-banner" as const,
  occasionSlug: "birthday" as const,
  subOccasion: "40th Birthday",
  themeSlugs: [],
  altText: "Black and gold 40th birthday roll-up banner",
  productSlug: "roll-up-banner" as const,
  contentHash: "b".repeat(64),
  mimeType: "image/jpeg" as const,
  width: 1200,
  height: 2400,
};

const props = {
  params: Promise.resolve({ slug: "black-and-gold-40th-birthday-roll-up-a1b2c3d4" }),
  searchParams: Promise.resolve({ from: "/design-gallery?occasion=birthday&page=2" }),
};

describe("public design detail page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.registry = defaultProductRegistry;
    state.market = "NZ";
    state.resolvedMarket = null;
    findByPublicSlug.mockResolvedValue(design);
    list.mockResolvedValue({ items: [], total: 0, page: 1, pageCount: 1, pageSize: 5 });
  });

  it("uses the selected Australia market for price and configuration destination", async () => {
    state.registry = enabledAustraliaRegistry();
    state.market = "AU";

    render(await DesignDetailPage(props));

    expect(screen.getByText("From A$320.00 AUD")).toBeVisible();
    expect(screen.queryByText(/NZ\$/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start With Your Photos" }))
      .toHaveAttribute("href", `/au/products/roll-up-banner/configure?design=${designId}`);
  });

  it("uses the server-resolved request market before a saved cookie on shared design URLs", async () => {
    state.registry = enabledAustraliaRegistry();
    state.market = "NZ";
    state.resolvedMarket = "AU";

    render(await DesignDetailPage(props));

    expect(screen.getByText("From A$320.00 AUD")).toBeVisible();
    expect(screen.getByRole("link", { name: "Start With Your Photos" }))
      .toHaveAttribute("href", `/au/products/roll-up-banner/configure?design=${designId}`);
  });

  it("uses on-demand revalidation instead of prebuilding every gallery design", () => {
    expect(revalidate).toBe(3600);
  });

  it("shows the artwork, known product details and the existing configurator destination", async () => {
    const { container } = render(await DesignDetailPage(props));

    expect(screen.getByRole("heading", { name: "40th Birthday" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: design.altText })).toHaveAttribute("width", "1200");
    expect(screen.getByRole("img", { name: design.altText })).toHaveAttribute(
      "sizes",
      "(max-width: 560px) calc(100vw - 2.5rem), (max-width: 820px) 92vw, (max-width: 1103px) calc(87vw - 20rem), (max-width: 1565px) 58vw, 907px",
    );
    expect(screen.getByText("Roll-up banner")).toBeInTheDocument();
    expect(screen.getByText("Birthday")).toBeInTheDocument();
    expect(screen.getByText("From NZ$264.50 incl GST")).toBeVisible();
    expect(screen.queryByText(/excl GST/i)).not.toBeInTheDocument();
    expect(screen.getByText("85 × 200 cm")).toBeVisible();
    expect(screen.queryByText("Design image")).not.toBeInTheDocument();
    expect(screen.queryByText("1200 × 2400 px")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start With Your Photos" }))
      .toHaveAttribute("href", `/products/roll-up-banner/configure?design=${designId}`);
    expect(screen.getByRole("link", { name: "View Similar Designs" }))
      .toHaveAttribute("href", "/design-gallery?occasion=birthday&page=2");
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" }))
      .not.toBeInTheDocument();
    const breadcrumbs = JSON.parse(container.querySelector("#rnr-design-breadcrumbs")?.textContent ?? "{}");
    expect(breadcrumbs).toMatchObject({
      "@type": "BreadcrumbList",
      itemListElement: [
        { position: 1, name: "Home" },
        { position: 2, name: "Design Gallery" },
        { position: 3, name: "40th Birthday" },
      ],
    });
  });

  it("renders every configured size as a separate list item in registry order", async () => {
    findByPublicSlug.mockResolvedValue({
      ...design,
      productTypeSlug: "canvas",
      productSlug: "photo-print-canvas",
    });

    render(await DesignDetailPage(props));

    const sizeList = screen.getByRole("list", { name: "Available sizes" });
    expect(within(sizeList).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "A4 — 29.7 × 21 cm",
      "A3 — 42 × 29.7 cm",
      "A2 — 59.4 × 42 cm",
      "A1 — 84.1 × 59.4 cm",
      "A0 — 118.9 × 84.1 cm",
    ]);
  });

  it("publishes metadata for the concrete artwork and its public canonical", async () => {
    const metadata = await generateMetadata(props);
    expect(metadata).toMatchObject({
      title: "40th Birthday Roll-up Banner Design",
      description: expect.stringContaining("40th Birthday"),
      alternates: {
        canonical: "https://rrgallery.co.nz/designs/40th-birthday-a1b2c3d4",
      },
      openGraph: {
        title: "40th Birthday Roll-up Banner Design",
        images: [expect.objectContaining({ url: expect.stringContaining(`/gallery-images/${designId}`) })],
      },
      robots: { index: true, follow: true },
    });
  });

  it("returns a real not-found response for invalid or non-public designs", async () => {
    findByPublicSlug.mockResolvedValue(null);
    await expect(DesignDetailPage({
      params: Promise.resolve({ slug: "missing-design-deadbeef" }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow("NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("renders related public artworks without duplicating the current design", async () => {
    list.mockResolvedValue({
      items: [design, { ...design, id: `e5f6a7b8${"e".repeat(56)}`, subOccasion: "50th Birthday", altText: "50th birthday roll-up banner" }],
      total: 2,
      page: 1,
      pageCount: 1,
      pageSize: 5,
    });
    render(await DesignDetailPage(props));

    const related = screen.getByRole("region", { name: "Related designs" });
    expect(within(related).queryByRole("img", { name: design.altText })).not.toBeInTheDocument();
    expect(within(related).getByRole("link", { name: /50th birthday/i }))
      .toHaveAttribute("href", "/designs/50th-birthday-e5f6a7b8");
    expect(within(related).getByRole("img", { name: "50th birthday roll-up banner" }))
      .toHaveAttribute(
        "sizes",
        "(max-width: 560px) calc((100vw - 3.25rem) / 2), (max-width: 767px) calc(46vw - 0.375rem), (max-width: 1179px) 45vw, (max-width: 1567px) 29.34vw, 459px",
      );
  });
});
