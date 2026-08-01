import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

describe("site shell", () => {
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
