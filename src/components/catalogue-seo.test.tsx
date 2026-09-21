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
        <CatalogueBuyingGuide category="canvas" />
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
    render(<CatalogueBuyingGuide category="canvas" />);
    expect(screen.getByText(/It is digital artwork printed on canvas/)).toBeVisible();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("connects banner formats to the existing occasion and product guides", () => {
    render(<CatalogueBuyingGuide category="banners" />);
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
