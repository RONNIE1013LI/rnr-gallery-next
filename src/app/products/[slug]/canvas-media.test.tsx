import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getProductBySlug } from "@/domain/catalogue/products";
import { ProductPageContent } from "./page-content";

vi.mock("@/server/admin/product-registry-runtime", () => ({
  getSafePublicProductRegistry: vi.fn(),
}));
vi.mock("@/server/gallery/gallery-runtime", () => ({
  getGalleryRuntime: vi.fn(),
}));
vi.mock("@/components/analytics-event-tracker", () => ({
  AnalyticsEventTracker: () => null,
}));
// WebGL is not available in jsdom. Exercise the real lazy preview/toggle and
// inspect the props delivered to the existing scene at that browser boundary.
vi.mock("@/components/canvas-product-scene", () => ({
  default: (props: { imageSrc: string; sizeKey: string; orientation?: string }) => (
    <div title="Interactive canvas preview" data-image={props.imageSrc}
      data-size={props.sizeKey} data-orientation={props.orientation} />
  ),
}));

const product = getProductBySlug("digital-oil-painting-canvas")!;

describe("Digital oil painting canvas product media", () => {
  it("shows the configurator's complete room image without a square crop", () => {
    const { container } = render(<ProductPageContent product={product} selection={null} />);
    const image = screen.getByRole("img", { name: product.image.alt });
    expect(decodeURIComponent(image.getAttribute("src") ?? ""))
      .toContain("/media/products/digital-oil-painting-canvas-shop.webp");
    expect(image).toHaveStyle({ objectFit: "contain" });
    expect(container.querySelector<HTMLElement>("[data-product-media] image" )).toBeNull();
    expect(container.querySelector<HTMLElement>("[data-product-media]")?.style.aspectRatio)
      .toBe("4 / 3");
  });

  it("opens real preview wiring on demand and restores the room image on close", async () => {
    render(<ProductPageContent product={product} selection={null} />);
    expect(screen.queryByTitle("Interactive canvas preview")).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "3D View" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    const scene = await screen.findByTitle("Interactive canvas preview");
    expect(scene).toHaveAttribute("data-image", "/canvas-3d/digital-oil-artwork.avif");
    expect(scene).toHaveAttribute("data-size", "a4");
    expect(scene).toHaveAttribute("data-orientation", "landscape");
    fireEvent.click(screen.getByRole("button", { name: "Close 3D view" }));
    expect(screen.queryByTitle("Interactive canvas preview")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: product.image.alt })).toBeVisible();
  });

  it("keeps selected artwork, portrait proportions, size and configure link", async () => {
    const designId = "a".repeat(64);
    const selection = {
      id: designId, title: "Selected portrait", altText: "Selected portrait artwork",
      imageUrl: `/gallery-images/${designId}?v=${"b".repeat(64)}`,
      contentHash: "b".repeat(64), productSlug: product.slug,
      width: 1200, height: 1600,
    };
    const { container } = render(<ProductPageContent product={product} selection={selection}
      selectedSizeKey="a1" analyticsSizeKey="a4" />);
    expect(container.querySelector<HTMLElement>("[data-product-media]")?.style.aspectRatio)
      .toBe("1200 / 1600");
    expect(screen.getByRole("link", { name: "Start Your Design" })).toHaveAttribute(
      "href", `/products/${product.slug}/configure?design=${designId}&size=a1`,
    );
    fireEvent.click(screen.getByRole("button", { name: "3D View" }));
    const scene = await screen.findByTitle("Interactive canvas preview");
    expect(scene).toHaveAttribute("data-image", selection.imageUrl);
    expect(scene).toHaveAttribute("data-size", "a1");
    expect(scene).toHaveAttribute("data-orientation", "portrait");
  });

  it("leaves other product media unchanged", () => {
    const other = getProductBySlug("photo-print-canvas")!;
    const { container } = render(<ProductPageContent product={other} selection={null} />);
    expect(screen.getByRole("img", { name: other.image.alt })).toBeVisible();
    expect(screen.queryByRole("button", { name: "3D View" })).not.toBeInTheDocument();
    expect(container.querySelector<HTMLElement>("[data-product-media]")?.style.aspectRatio)
      .toBe("");
  });
});
