import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import CanvasPage from "./page";

const state = vi.hoisted(() => ({ registry: undefined as typeof defaultProductRegistry | undefined }));

vi.mock("@/server/admin/product-registry-runtime", () => ({
  getSafePublicProductRegistry: async () => ({ registry: state.registry ?? defaultProductRegistry }),
}));

describe("Canvas page", () => {
  it("keeps the memorial guide links in sync with the active catalogue", async () => {
    const registry = structuredClone(defaultProductRegistry);
    const portrait = registry.products.find((product) => product.key === "digital-oil-painting-canvas");
    if (!portrait) throw new Error("Missing portrait product fixture");
    portrait.active = false;
    state.registry = registry;
    try {
      render(await CanvasPage());
      const guide = within(screen.getByRole("region", { name: "Choose a personalised memorial canvas" }));
      expect(guide.queryByRole("link", { name: "digital oil painting portrait" })).not.toBeInTheDocument();
      expect(guide.getByText(/digital oil painting portrait/)).toBeVisible();
      expect(guide.getByRole("link", { name: "themed canvas" })).toHaveAttribute("href", "/products/custom-themed-canvas");
    } finally {
      state.registry = undefined;
    }
  });

  it("keeps the advertising landing page out of the catalogue introduction", async () => {
    render(await CanvasPage());

    expect(screen.queryByRole("navigation", { name: "Product guides" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /learn more about custom photo canvas/i }))
      .not.toBeInTheDocument();
    expect(screen.getAllByText("Create Your Artwork").length).toBeGreaterThan(0);
  });
});
