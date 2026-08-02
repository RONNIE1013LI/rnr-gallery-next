import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

describe("site shell", () => {
  beforeEach(() => localStorage.clear());

  it("offers the main storefront routes", () => {
    render(<SiteHeader />);

    expect(screen.getByRole("link", { name: /r&r gallery/i })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("navigation", { name: /primary/i })).toBeVisible();
    expect(screen.getAllByRole("link", { name: "Shop" })[0]).toHaveAttribute(
      "href",
      "/shop",
    );
    expect(screen.getAllByRole("link", { name: "Canvas" })[0]).toHaveAttribute(
      "href",
      "/canvas",
    );
    expect(screen.getAllByRole("link", { name: "Banners" })[0]).toHaveAttribute(
      "href",
      "/banners",
    );
    expect(screen.getByRole("link", { name: /cart/i })).toHaveAttribute(
      "href",
      "/cart",
    );
    expect(screen.getByText("Menu")).toBeInTheDocument();
  });

  it("shows the persisted cart quantity", () => {
    localStorage.setItem(
      "rnr-cart-v1",
      JSON.stringify({
        version: 1,
        items: [{
          id: "item",
          productKey: "photo-print-canvas",
          productSlug: "photo-print-canvas",
          productTitle: "Photo Print Canvas",
          imageSrc: "/media/home/family-canvas.webp",
          sizeKey: "a4",
          sizeLabel: "A4",
          peoplePets: 0,
          photoSubmissionMethod: "later",
          designText: "",
          notes: "",
          neededDate: "2026-08-10",
          deliveryPreference: "post",
          quantity: 2,
          price: { lines: [], subtotalExGstCents: 6500, gstCents: 975, totalInclGstCents: 7475 },
          uploadReferences: [],
        }],
      }),
    );
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: "Cart, 2 items" })).toBeInTheDocument();
  });

  it("keeps support and legal links in the footer", () => {
    render(<SiteFooter />);
    const footer = screen.getByRole("contentinfo");

    expect(within(footer).getByRole("link", { name: /message r&r/i })).toBeVisible();
    expect(within(footer).getByRole("link", { name: /\+64 21 023 48948/i })).toBeVisible();
    expect(
      within(footer).getByRole("link", {
        name: /customerservice@rnrgallery.com/i,
      }),
    ).toBeVisible();
    expect(within(footer).getByRole("link", { name: /privacy/i })).toHaveAttribute(
      "href",
      "/privacy",
    );
  });
});
