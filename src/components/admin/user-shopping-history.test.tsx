import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UserShoppingHistoryPanel } from "./user-shopping-history";
describe("user shopping history panel", () => {
  it("distinguishes unavailable data from no recorded activity", () => {
    const view = render(<UserShoppingHistoryPanel history={{ status: "unavailable" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("temporarily unavailable");
    expect(screen.queryByText("No linked activity recorded in the last 90 days.")).not.toBeInTheDocument();
    view.rerender(<UserShoppingHistoryPanel history={{ status: "available", events: [], hasMore: false }} />);
    expect(screen.getByText("No linked activity recorded in the last 90 days.")).toBeInTheDocument();
  });
  it("renders pages, cart estimates, checkout and submitted orders without implying payment", () => {
    const at = "2026-11-03T20:00:00.000Z";
    render(<UserShoppingHistoryPanel history={{ status: "available", hasMore: true, events: [
      { id: "p", kind: "pageview", occurredAt: at, pathname: "/products/photo-print-canvas" },
      { id: "c", kind: "cart", occurredAt: at, currency: "NZD", totalInclGstCents: 5000, items: [], changes: ["Removed Photo Print Canvas (A4) × 1"] },
      { id: "x", kind: "checkout", occurredAt: at, currency: "AUD", totalInclGstCents: 4000, items: [], changes: [] },
      { id: "o", kind: "order", occurredAt: at, orderNumber: "08123", currency: "NZD", totalInclGstCents: 6000, paymentStatus: "awaiting_payment" },
    ] }} />);
    expect(screen.getByRole("link", { name: "/products/photo-print-canvas" })).toHaveAttribute("href", "/products/photo-print-canvas");
    expect(screen.getByText("Removed Photo Print Canvas (A4) × 1")).toBeInTheDocument();
    expect(screen.getByText(/Checkout cart recorded/)).toBeInTheDocument();
    expect(screen.getByText(/Order submitted: 08123/)).toBeInTheDocument();
    expect(screen.getByText(/awaiting payment/)).toBeInTheDocument();
    expect(screen.getByText(/Showing the latest 200/)).toBeInTheDocument();
    expect(screen.getAllByText(/Estimate/)).toHaveLength(2);
    expect(screen.getAllByText(/04 Nov 2026/)).toHaveLength(4);
  });
});
