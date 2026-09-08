import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductConfigurator } from "./product-configurator";
import { getConfigurationSchema } from "@/domain/configuration/schemas";
import { getProductBySlug } from "@/domain/catalogue/products";
vi.mock("./roll-up-banner-scene", () => ({ default: ({ imageSrc }: { imageSrc?: string }) => <div title="Interactive roll-up banner preview" data-image={imageSrc} /> }));
vi.mock("@/domain/analytics/client", () => ({ emitAnalyticsEvent: vi.fn() }));
const product = getProductBySlug("roll-up-banner")!;
const props = { product, schema: getConfigurationSchema(product.key)!, orderDate: "2026-09-08" };
describe("roll-up banner integration", () => {
  it("uses any selected design and updates the open 3D preview when it changes", async () => {
    const design = { id: "a".repeat(64), title: "Selected", altText: "Selected", imageUrl: "/gallery-images/first?v=original", contentHash: "original", productSlug: "roll-up-banner" as const, width: 850, height: 2000 };
    const { rerender } = render(<ProductConfigurator {...props} selectedDesign={design} />);
    fireEvent.click(screen.getByRole("button", { name: "3D View" }));
    expect(await screen.findByTitle("Interactive roll-up banner preview")).toHaveAttribute("data-image", design.imageUrl);
    rerender(<ProductConfigurator {...props} selectedDesign={{ ...design, imageUrl: "/gallery-images/second?v=new" }} />);
    expect(screen.getByTitle("Interactive roll-up banner preview")).toHaveAttribute("data-image", "/gallery-images/second?v=new");
    fireEvent.click(screen.getByRole("button", { name: "Close 3D view" }));
    expect(screen.queryByTitle("Interactive roll-up banner preview")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View full image" })).toBeInTheDocument();
  });
  it("uses the dedicated default artwork instead of an unrelated related design", async () => {
    const unrelatedDesign = { id: "b".repeat(64), title: "Unrelated", altText: "Unrelated", imageUrl: "/gallery-images/unrelated?v=old", contentHash: "old", productSlug: "roll-up-banner" as const, width: 850, height: 2000 };
    render(<ProductConfigurator {...props} relatedDesigns={[unrelatedDesign]} />);
    fireEvent.click(screen.getByRole("button", { name: "3D View" }));
    expect(await screen.findByTitle("Interactive roll-up banner preview"))
      .toHaveAttribute("data-image", "/roll-up-banner-3d/default-artwork.avif");
  });
});
