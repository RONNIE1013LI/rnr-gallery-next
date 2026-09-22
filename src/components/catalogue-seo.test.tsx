import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { products } from "@/domain/catalogue/products";
import { CataloguePage } from "./catalogue-page";
import { CatalogueBuyingGuide } from "./catalogue-buying-guide";

vi.mock("@/domain/analytics/client", () => ({
  emitAnalyticsEvent: vi.fn(() => true),
}));

const canvasProducts = products.filter((product) => product.category === "canvas");

describe("Catalogue public product links", () => {
  it.each(["NZ", "AU"] as const)(
    "adds %s public product links without changing the configure actions",
    (market) => {
      const prefix = market === "AU" ? "/au" : "";
      const { container } = render(
        <CataloguePage
          eyebrow="CANVAS"
          title="Canvas"
          description="Compare artwork options"
          path={`${prefix}/canvas`}
          market={market}
          products={canvasProducts}
          showProductDetailLinks
          pricesInclTaxCents={market === "AU"
            ? Object.fromEntries(canvasProducts.map((product) => [product.key, 32_000]))
            : undefined}
        />,
      );

      const information = within(screen.getByRole("navigation", { name: "Product information" }));
      for (const product of canvasProducts) {
        expect(information.getByRole("link", { name: `${product.title} details` }))
          .toHaveAttribute("href", `${prefix}/products/${product.slug}`);
        const configureLink = Array.from(container.querySelectorAll("a"))
          .find((link) => link.getAttribute("href") === `${prefix}/products/${product.slug}/configure`);
        expect(configureLink).toBeDefined();
        expect(configureLink).toHaveTextContent("Create Your Artwork");
      }
      expect(container.querySelector("a a")).toBeNull();
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    },
  );

  it("omits the product-information navigation unless the route explicitly enables it", () => {
    render(<CataloguePage eyebrow="" title="Shop" description="" products={canvasProducts} />);
    expect(screen.queryByRole("navigation", { name: "Product information" })).not.toBeInTheDocument();
  });

  it("renders route-specific buying guidance without introducing a second H1", () => {
    render(
      <CataloguePage eyebrow="CANVAS" title="Canvas" description="" products={canvasProducts}>
        <CatalogueBuyingGuide category="canvas" market="NZ" />
      </CataloguePage>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Choosing your personalised canvas" })).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "photo canvas guide" }))
      .toHaveAttribute("href", "/custom-photo-canvas-nz");
  });
});

describe("NZ category buying guidance", () => {
  it("distinguishes digitally created canvas artwork from hand-applied oil paint", () => {
    render(<CatalogueBuyingGuide category="canvas" market="NZ" />);
    expect(screen.getByText(/It is digital artwork printed on canvas/)).toBeVisible();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("connects banner formats to the existing occasion and product guides", () => {
    render(<CatalogueBuyingGuide category="banners" market="NZ" />);
    for (const [name, href] of [
      ["roll-up banner guide", "/custom-roll-up-banners-nz"],
      ["wall banner guide", "/custom-wall-banners-nz"],
      ["personalised birthday banners", "/birthday-banners"],
      ["memorial and funeral banners", "/memorial-banners"],
    ]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });
});

describe("AU category buying guidance", () => {
  it("uses Australian canvas copy and verified AU or shared destinations", () => {
    render(<CatalogueBuyingGuide category="canvas" market="AU" />);

    expect(screen.getByRole("heading", { level: 2, name: "Choosing personalised canvas for Australia" }))
      .toBeVisible();
    expect(screen.getByRole("link", { name: "photo canvas product details" }))
      .toHaveAttribute("href", "/au/products/photo-print-canvas");
    expect(screen.getByRole("link", { name: "design gallery" }))
      .toHaveAttribute("href", "/design-gallery");
    expect(screen.queryByText(/New Zealand|NZ\$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/local production|pickup|fixed shipping/i)).not.toBeInTheDocument();
  });

  it("uses Australian banner product pages instead of NZ-only guides", () => {
    const { container } = render(<CatalogueBuyingGuide category="banners" market="AU" />);

    for (const [name, href] of [
      ["roll-up banner details", "/au/products/roll-up-banner"],
      ["wall banner details", "/au/products/custom-themed-wall-banner"],
      ["banner bundle details", "/au/products/banner-bundle"],
      ["grave cover details", "/au/products/grave-cover"],
    ]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
    expect(Array.from(container.querySelectorAll("a")).map((link) => link.getAttribute("href")))
      .not.toEqual(expect.arrayContaining([
        "/custom-roll-up-banners-nz",
        "/custom-wall-banners-nz",
        "/birthday-banners",
        "/memorial-banners",
      ]));
  });
});
