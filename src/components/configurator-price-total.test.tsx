import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConfiguratorPriceTotal } from "./configurator-price-total";
describe("configurator total preview", () => {
  it("shows the original total beside the red bold conditional first-order price", () => {
    render(<dl><ConfiguratorPriceTotal totalCents={12075} firstOrderTotalCents={9660} currency="NZD" taxRegistered /></dl>);
    const offer = screen.getByText("20% OFF · now NZ$96.60");
    expect(offer.tagName).toBe("STRONG"); expect(offer.className).toContain("configuratorOfferPrice");
    expect(screen.getByText("NZ$120.75")).toBeInTheDocument();
    expect(screen.getByText("Promotional price")).toBeInTheDocument();
  });
  it("keeps the ordinary total when the promotion is off", () => {
    render(<dl><ConfiguratorPriceTotal totalCents={12075} firstOrderTotalCents={null} currency="NZD" taxRegistered /></dl>);
    expect(screen.queryByText(/20% OFF/)).not.toBeInTheDocument();
    expect(screen.getByText("Total incl GST")).toBeInTheDocument();
    expect(screen.getByText("NZ$120.75")).toBeInTheDocument();
  });
});
