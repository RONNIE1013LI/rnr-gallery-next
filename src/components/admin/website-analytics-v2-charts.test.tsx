import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebsiteAnalyticsV2DashboardData } from "./website-analytics-v2-dashboard";
import { WebsiteAnalyticsV2Charts } from "./website-analytics-v2-charts";

class SizedResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    this.callback([{
      contentRect: { width: 720, height: 280 },
      target,
    } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }

  unobserve() {}
  disconnect() {}
}

const money = (currency: "NZD" | "AUD", value: number) => ({
  currency,
  orderedRevenueCents: value,
  collectedRevenueCents: value - 1_000,
  refundedRevenueCents: 1_000,
  netCollectedRevenueCents: value - 2_000,
  orderedAovCents: Math.round(value / 2),
});

const data: WebsiteAnalyticsV2DashboardData = {
  filters: {
    preset: "custom",
    from: "2026-08-29",
    to: "2026-08-30",
    scope: "all_business",
    market: null,
    currency: null,
    attribution: "last_touch",
    granularity: "day",
    resolvedGranularity: "day",
    compare: false,
    canonicalQuery: "preset=custom",
  },
  kpis: {
    visitors: 9,
    sessions: 12,
    pageViews: 30,
    inquiries: 4,
    orders: 3,
    paidOrders: 2,
    inquiryConversionRate: 1 / 3,
    orderConversionRate: 1 / 6,
    paidOrderConversionRate: 1 / 12,
    money: [money("NZD", 24_000), money("AUD", 50_000)],
  },
  comparison: null,
  timeseries: [
    {
      bucket: "2026-08-29",
      visitors: 4,
      sessions: 5,
      pageViews: 12,
      inquiries: 1,
      orders: 1,
      paidOrders: 1,
      inquiryConversionRate: 0.2,
      orderConversionRate: 0.2,
      paidOrderConversionRate: 0.2,
      money: [money("NZD", 10_000), money("AUD", 20_000)],
    },
    {
      bucket: "2026-08-30",
      visitors: 5,
      sessions: 7,
      pageViews: 18,
      inquiries: 3,
      orders: 2,
      paidOrders: 1,
      inquiryConversionRate: 3 / 7,
      orderConversionRate: 1 / 7,
      paidOrderConversionRate: 1 / 7,
      money: [money("NZD", 14_000), money("AUD", 30_000)],
    },
  ],
  funnel: { scope: "website", sessions: 12, inquiries: 4, orders: 2, paidOrders: 1 },
  channels: [{
    channel: "Google Ads",
    visitors: 5,
    sessions: 6,
    pageViews: 17,
    inquiries: 2,
    orders: 2,
    paidOrders: 1,
    money: [money("NZD", 20_000)],
  }],
  campaigns: [{
    channel: "Google Ads",
    source: "google",
    medium: "cpc",
    campaign: "spring",
    visitors: 4,
    sessions: 5,
    pageViews: 14,
    inquiries: 2,
    orders: 2,
    paidOrders: 1,
    money: [money("NZD", 20_000)],
  }],
  pages: { items: [{ pathname: "/shop", visitors: 5, pageViews: 12 }], unavailableMetrics: ["entrances", "exits", "assists"] },
  payments: [{ status: "paid", orders: 2 }, { status: "partial", orders: 1 }],
  markets: [{
    market: "NZ",
    visitors: 7,
    sessions: 9,
    pageViews: 22,
    inquiries: 3,
    orders: 2,
    paidOrders: 1,
    money: [money("NZD", 24_000)],
  }],
  countries: [{ countryCode: "NZ", visitors: 7, sessions: 9, pageViews: 22 }],
  notices: [],
  metadata: {
    timezone: "Pacific/Auckland",
    trafficScope: "website",
    aggregateThrough: "2026-08-29",
    rawDates: ["2026-08-30"],
    earliestTrafficDate: "2026-08-01",
    trafficCoverageFrom: "2026-08-01",
    trafficMetricsAvailable: true,
    generatedAt: "2026-08-30T00:00:00.000Z",
  },
};

describe("WebsiteAnalyticsV2Charts", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", SizedResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders static keyboard-accessible trend, currency, funnel and breakdown charts", async () => {
    const { container } = render(<WebsiteAnalyticsV2Charts data={data} />);

    const traffic = await screen.findByRole("application", { name: "Traffic trend chart" });
    expect(screen.getByRole("application", { name: "NZD revenue trend chart" })).toBeInTheDocument();
    expect(screen.getByRole("application", { name: "AUD revenue trend chart" })).toBeInTheDocument();
    expect(screen.getByRole("application", { name: "Website funnel chart" })).toBeInTheDocument();
    expect(screen.getByRole("application", { name: "Channel performance chart" })).toBeInTheDocument();
    expect(screen.getByRole("application", { name: "Payment status chart" })).toBeInTheDocument();
    expect(screen.getByRole("application", { name: "Market performance chart" })).toBeInTheDocument();
    expect(screen.getByRole("application", { name: "Country traffic chart" })).toBeInTheDocument();

    for (const wrapper of container.querySelectorAll(".recharts-wrapper")) {
      expect(wrapper.querySelectorAll(".recharts-yAxis").length).toBeLessThanOrEqual(1);
    }
    expect(container.querySelectorAll(".recharts-line-curve").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".recharts-bar-rectangle").length).toBeGreaterThan(0);

    traffic.focus();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("2026-08-29"));
    fireEvent.keyDown(traffic, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("2026-08-30"));
  });

  it("provides exact equivalent tables and never combines NZD with AUD", () => {
    render(<WebsiteAnalyticsV2Charts data={data} />);

    const trafficTable = screen.getByRole("table", { name: "Traffic trend data" });
    expect(within(trafficTable).getByText("2026-08-30")).toBeInTheDocument();
    expect(within(trafficTable).getByText("18")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "NZD revenue trend data" })).toHaveTextContent("NZ$140.00");
    expect(screen.getByRole("table", { name: "AUD revenue trend data" })).toHaveTextContent("A$300.00");
    expect(screen.getByRole("table", { name: "Website funnel data" })).toHaveTextContent("Paid Orders1");
    expect(screen.getByRole("table", { name: "Channel performance data" })).toHaveTextContent("Google Ads");
    expect(screen.getByRole("table", { name: "Campaign performance data" })).toHaveTextContent("spring");
    expect(screen.getByRole("table", { name: "Payment status data" })).toHaveTextContent("Partial1");
    expect(screen.getByRole("table", { name: "Market performance data" })).toHaveTextContent("NZ");
    expect(screen.getByRole("table", { name: "Country traffic data" })).toHaveTextContent("NZ");
    expect(screen.queryByText(/combined revenue/i)).not.toBeInTheDocument();
  });

  it("switches the single-axis traffic series without changing the server values", async () => {
    const { container } = render(<WebsiteAnalyticsV2Charts data={data} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Traffic metric" }), {
      target: { value: "orders" },
    });

    expect(screen.getByRole("combobox", { name: "Traffic metric" })).toHaveValue("orders");
    await waitFor(() => expect(container.querySelector(".recharts-line-curve")).toBeInTheDocument());
    const table = screen.getByRole("table", { name: "Traffic trend data" });
    const row = within(table).getByText("2026-08-30").closest("tr")!;
    expect(within(row).getAllByRole("cell")[4]).toHaveTextContent("2");
  });
});
