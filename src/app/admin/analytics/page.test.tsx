import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminAnalyticsPage from "./page";

const { requireAdminPage, load } = vi.hoisted(() => ({ requireAdminPage: vi.fn(), load: vi.fn() }));
vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/analytics/website-analytics-dashboard", () => ({
  WEBSITE_ANALYTICS_PERIODS: ["today", "yesterday", "7d", "30d"],
  getWebsiteAnalyticsDashboard: () => ({ load }),
}));

describe("admin website analytics page", () => {
  it("requires analytics permission and renders the minimum dashboard", async () => {
    load.mockResolvedValue({
      period: "today",
      metrics: { visitors: 12, sessions: 14, pageviews: 28 },
      channels: [{ channel: "google_ads", visitors: 4, sessions: 5, pageviews: 9 }],
      countries: [{ countryCode: "NZ", visitors: 10, pageviews: 24 }],
      topPages: [{ pathname: "/shop", visitors: 8, pageviews: 18 }],
      trend: [{ localDate: "2026-08-29", visitors: 12, pageviews: 28 }],
    });

    render(await AdminAnalyticsPage({ searchParams: Promise.resolve({ period: "today" }) }));

    expect(requireAdminPage).toHaveBeenCalledWith("/admin/analytics", "view_analytics");
    expect(screen.getByRole("heading", { name: "Website Analytics" })).toBeInTheDocument();
    expect(screen.getByText("28", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("Google Ads")).toBeInTheDocument();
    expect(screen.getByText("/shop")).toBeInTheDocument();
    expect(screen.getByText("NZ")).toBeInTheDocument();
  });
});
