import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";

vi.mock("next/navigation", () => ({ usePathname: () => "/shop" }));
vi.mock("./cart-count", () => ({ CartCount: () => <a href="/cart">Cart</a> }));
vi.mock("./market-selector", () => ({ MarketSelector: () => null }));
vi.mock("./consent-preferences", () => ({ CookiePreferencesTrigger: () => null }));
vi.mock("next/image", () => ({ default: ({ src, alt }: { src: string; alt: string }) => createElement("img", { src, alt }) }));

import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";

describe("Supplies navigation", () => {
  it("keeps every Supplies entry hidden by default", () => {
    render(<><SiteHeader /><SiteFooter /></>);
    expect(screen.queryByRole("link", { name: "Supplies & Accessories" })).toBeNull();
  });

  it("adds the fourth Shop item, mobile link and footer only when enabled in NZ", () => {
    render(<><SiteHeader suppliesEnabled /><SiteFooter suppliesEnabled /></>);
    const menu = screen.getByRole("navigation", { name: "Shop menu" });
    expect(within(menu).getAllByRole("link")[3]).toHaveAttribute("href", "/supplies");
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    expect(within(screen.getByRole("navigation", { name: "Mobile navigation" }))
      .getByRole("link", { name: "Supplies & Accessories" })).toHaveAttribute("href", "/supplies");
    expect(screen.getAllByRole("link", { name: "Supplies & Accessories" })).toHaveLength(3);
  });

  it("does not offer Supplies to the AU market", () => {
    render(<><SiteHeader suppliesEnabled initialMarket="AU" /><SiteFooter suppliesEnabled market="AU" /></>);
    expect(screen.queryByRole("link", { name: "Supplies & Accessories" })).toBeNull();
  });
});
