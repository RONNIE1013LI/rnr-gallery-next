import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emitAnalyticsEvent } from "@/domain/analytics/client";
import { AnalyticsLink } from "./analytics-link";

vi.mock("@/domain/analytics/client", () => ({
  emitAnalyticsEvent: vi.fn(() => true),
}));

describe("AnalyticsLink", () => {
  it("keeps contact navigation and marks an explicitly tracked click for delegate dedupe", () => {
    render(
      <AnalyticsLink
        href="https://m.me/RandRgallery"
        events={[
          { event: "messenger_click", location: "/contact" },
          { event: "generate_lead", method: "messenger" },
        ]}
      >
        Message on Messenger
      </AnalyticsLink>,
    );

    const link = screen.getByRole("link", { name: "Message on Messenger" });
    expect(link).toHaveAttribute("href", "https://m.me/RandRgallery");
    expect(link).toHaveAttribute("data-rnr-meta-contact-tracked", "true");
    fireEvent.click(link);
    expect(emitAnalyticsEvent).toHaveBeenNthCalledWith(1, {
      event: "messenger_click",
      location: "/contact",
    });
    expect(emitAnalyticsEvent).toHaveBeenNthCalledWith(2, {
      event: "generate_lead",
      method: "messenger",
    });
  });

  it("does not mark ordinary analytics links as Meta Contact", () => {
    render(
      <AnalyticsLink
        href="/products/photo-print-canvas"
        events={{ event: "generate_lead", method: "catalogue" }}
      >
        View product
      </AnalyticsLink>,
    );

    expect(screen.getByRole("link", { name: "View product" }))
      .not.toHaveAttribute("data-rnr-meta-contact-tracked");
  });
});
