import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminAnalyticsPage from "./page";

const {
  requireAdminPage,
  readBusinessConfig,
  v1Load,
  v2Load,
  listOrders,
  replace,
} = vi.hoisted(() => ({
  requireAdminPage: vi.fn(),
  readBusinessConfig: vi.fn(),
  v1Load: vi.fn(),
  v2Load: vi.fn(),
  listOrders: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/analytics",
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(
    "preset=custom&from=2026-08-30&to=2026-08-30&scope=all_business",
  ),
}));
vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/analytics/website-analytics-config", () => ({
  readWebsiteAnalyticsBusinessConfig: readBusinessConfig,
}));
vi.mock("@/server/analytics/website-analytics-dashboard", () => ({
  WEBSITE_ANALYTICS_PERIODS: ["today", "yesterday", "7d", "30d"],
  getWebsiteAnalyticsDashboard: () => ({ load: v1Load }),
}));
vi.mock("@/server/analytics/website-analytics-v2-dashboard", () => ({
  getWebsiteAnalyticsV2Dashboard: () => ({ load: v2Load, listOrders }),
}));

const v1Result = {
  period: "30d",
  metrics: { visitors: 12, sessions: 14, pageviews: 28 },
  channels: [{ channel: "google_ads", visitors: 4, sessions: 5, pageviews: 9 }],
  countries: [{ countryCode: "NZ", visitors: 10, pageviews: 24 }],
  topPages: [{ pathname: "/shop", visitors: 8, pageviews: 18 }],
  trend: [{ localDate: "2026-08-29", visitors: 12, pageviews: 28 }],
};

const canonicalQuery = [
  "preset=custom",
  "from=2026-08-30",
  "to=2026-08-30",
  "scope=all_business",
  "market=all",
  "currency=all",
  "attribution=last_touch",
  "granularity=auto",
  "compare=false",
  "sort=occurred_at_desc",
  "page=1",
  "pageSize=25",
].join("&");

const v2Result = {
  filters: {
    preset: "custom" as const,
    from: "2026-08-30",
    to: "2026-08-30",
    scope: "all_business" as const,
    market: null,
    currency: null,
    attribution: "last_touch" as const,
    granularity: "auto" as const,
    resolvedGranularity: "day" as const,
    compare: false,
    canonicalQuery,
  },
  kpis: {
    visitors: 12,
    sessions: 14,
    pageViews: 28,
    inquiries: 3,
    orders: 2,
    paidOrders: 1,
    inquiryConversionRate: 3 / 14,
    orderConversionRate: 2 / 14,
    paidOrderConversionRate: 1 / 14,
    money: [],
  },
  comparison: null,
  timeseries: [],
  funnel: { scope: "website" as const, sessions: 14, inquiries: 3, orders: 1, paidOrders: 1 },
  channels: [],
  campaigns: [],
  pages: { items: [], unavailableMetrics: ["entrances", "exits", "assists"] as const },
  payments: [],
  markets: [],
  countries: [],
  notices: [{
    code: "all_business_traffic_website_only",
    message: "Traffic and funnel metrics remain Website-only in All Business scope.",
  }],
  metadata: {
    timezone: "Pacific/Auckland" as const,
    trafficScope: "website" as const,
    aggregateThrough: null,
    rawDates: ["2026-08-30"],
    earliestTrafficDate: "2026-08-01",
    trafficCoverageFrom: "2026-08-01",
    trafficMetricsAvailable: true,
    generatedAt: "2026-08-30T00:00:00.000Z",
  },
};

const orderResult = { items: [], total: 0, page: 1, pageSize: 25, pageCount: 0 };

describe("admin website analytics page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminPage.mockResolvedValue(undefined);
    v1Load.mockResolvedValue(v1Result);
    v2Load.mockResolvedValue(v2Result);
    listOrders.mockResolvedValue(orderResult);
  });

  it("preserves the V1 query and dashboard when V2 is disabled", async () => {
    readBusinessConfig.mockReturnValue({ v2Enabled: false });

    render(await AdminAnalyticsPage({ searchParams: Promise.resolve({ period: "30d" }) }));

    expect(requireAdminPage).toHaveBeenCalledWith("/admin/analytics", "view_analytics");
    expect(v1Load).toHaveBeenCalledWith("30d");
    expect(v2Load).not.toHaveBeenCalled();
    expect(listOrders).not.toHaveBeenCalled();
    expect(screen.getByRole("navigation", { name: "Analytics period" })).toBeInTheDocument();
    expect(screen.getByText("Google Ads")).toBeInTheDocument();
    expect(screen.getByText("/shop")).toBeInTheDocument();
  });

  it("authenticates before loading canonical V2 SSR dashboard and order data", async () => {
    readBusinessConfig.mockReturnValue({ v2Enabled: true });

    render(await AdminAnalyticsPage({
      searchParams: Promise.resolve({
        preset: "custom",
        from: "2026-08-30",
        to: "2026-08-30",
        scope: "all_business",
      }),
    }));

    expect(requireAdminPage).toHaveBeenCalledWith("/admin/analytics", "view_analytics");
    expect(requireAdminPage.mock.invocationCallOrder[0]).toBeLessThan(v2Load.mock.invocationCallOrder[0]!);
    expect(v1Load).not.toHaveBeenCalled();
    expect(v2Load).toHaveBeenCalledWith(expect.objectContaining({
      preset: "custom",
      from: "2026-08-30",
      to: "2026-08-30",
      scope: "all_business",
      canonicalQuery,
    }), expect.any(Date));
    expect(listOrders).toHaveBeenCalledWith(expect.objectContaining({ canonicalQuery }));
    expect(screen.getByRole("heading", { name: "Website Analytics" })).toBeInTheDocument();
    expect(screen.getByText("All Business")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Key performance indicators")).getByText("Paid Orders"))
      .toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Analytics period" })).not.toBeInTheDocument();
  });
});
