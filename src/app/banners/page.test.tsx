import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import BannersPage from "./page";

vi.mock("@/server/admin/product-registry-runtime", () => ({
  getSafePublicProductRegistry: async () => ({ registry: defaultProductRegistry }),
}));

describe("Banners page", () => {
  it("lists Banner Bundle with its supplied product image and exact NZ price", async () => {
    render(await BannersPage());

    const heading = screen.getByRole("heading", { name: "Banner Bundle" });
    const card = heading.closest("article");
    expect(card).not.toBeNull();
    const image = within(card!).getByRole("img", {
      name: "A roll-up banner and matching wall banner prepared as a personalised event package",
    });
    expect(new URL(image.getAttribute("src")!, "https://rrgallery.co.nz")
      .searchParams.get("url")).toBe("/media/products/banner-bundle.webp");
    expect(within(card!).getByText("From NZ$359.99 incl GST")).toBeVisible();
  });
});
