import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import CanvasPage from "./page";

vi.mock("@/server/admin/product-registry-runtime", () => ({
  getSafePublicProductRegistry: async () => ({ registry: defaultProductRegistry }),
}));

describe("Canvas page", () => {
  it("keeps the advertising landing page out of the catalogue introduction", async () => {
    render(await CanvasPage());

    expect(screen.queryByRole("navigation", { name: "Product guides" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /learn more about custom photo canvas/i }))
      .not.toBeInTheDocument();
    expect(screen.getAllByText("Create Your Artwork").length).toBeGreaterThan(0);
  });
});
