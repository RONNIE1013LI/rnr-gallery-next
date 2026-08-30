import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WebsiteAnalyticsV2Dashboard,
  type WebsiteAnalyticsV2DashboardData,
  type WebsiteAnalyticsV2OrdersData,
} from "./website-analytics-v2-dashboard";

const navigation = vi.hoisted(() => ({
  pathname: "/admin/analytics",
  search: "scope=all_business",
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock("./website-analytics-v2-charts", () => ({
  WebsiteAnalyticsV2Charts: () => <section aria-label="Analytics chart collection" />,
  formatAnalyticsMoney: (currency: string, cents: number) => `${currency}:${cents}`,
}));

const canonicalQuery = [
  "preset=custom",
  "from=2026-08-29",
  "to=2026-08-30",
  "scope=all_business",
  "market=all",
  "currency=all",
  "attribution=last_touch",
  "granularity=day",
  "compare=false",
  "sort=occurred_at_desc",
  "page=1",
  "pageSize=25",
].join("&");

function money(currency: "NZD" | "AUD", orderedRevenueCents: number) {
  return {
    currency,
    orderedRevenueCents,
    collectedRevenueCents: orderedRevenueCents - 1_000,
    refundedRevenueCents: 1_000,
    netCollectedRevenueCents: orderedRevenueCents - 2_000,
    orderedAovCents: Math.round(orderedRevenueCents / 2),
  };
}

function dashboardData(overrides: Partial<WebsiteAnalyticsV2DashboardData> = {}): WebsiteAnalyticsV2DashboardData {
  return {
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
      canonicalQuery,
    },
    kpis: {
      visitors: 9,
      sessions: 12,
      pageViews: 30,
      inquiries: 4,
      orders: 3,
      paidOrders: 2,
      inquiryConversionRate: 1 / 3,
      orderConversionRate: null,
      paidOrderConversionRate: 1 / 12,
      money: [money("NZD", 24_000), money("AUD", 50_000)],
    },
    comparison: null,
    timeseries: [],
    funnel: { scope: "website", sessions: 12, inquiries: 4, orders: 2, paidOrders: 1 },
    channels: [],
    campaigns: [],
    pages: {
      items: [{ pathname: "/shop", visitors: 5, pageViews: 12 }],
      available: true,
      coverageFrom: "2026-08-01",
      unavailableMetrics: ["entrances", "exits", "assists"],
    },
    payments: [],
    markets: [],
    countries: [],
    notices: [
      {
        code: "all_business_traffic_website_only",
        message: "Traffic and funnel metrics remain Website-only in All Business scope.",
      },
      {
        code: "page_metrics_unavailable",
        message: "Page entrances, exits and conversion assists are unavailable from the implemented facts.",
      },
    ],
    metadata: {
      timezone: "Pacific/Auckland",
      trafficScope: "website",
      aggregateThrough: "2026-08-29",
      rawDates: ["2026-08-30"],
      earliestTrafficDate: "2026-08-01",
      trafficCoverageFrom: "2026-08-01",
      trafficMetricsAvailable: true,
      trafficBreakdownsAvailable: true,
      generatedAt: "2026-08-30T00:00:00.000Z",
    },
    ...overrides,
  };
}

function orderData(overrides: Partial<WebsiteAnalyticsV2OrdersData> = {}): WebsiteAnalyticsV2OrdersData {
  return {
    items: [{
      conversionId: "conversion-1",
      source: "website",
      orderId: "order-1",
      productionJobId: null,
      reference: "RNR-001",
      occurredAt: "2026-08-30T00:00:00.000Z",
      localDate: "2026-08-30",
      market: "NZ",
      currency: "NZD",
      orderedAmountCents: 12_000,
      collectedAmountCents: 12_000,
      refundedAmountCents: 0,
      netCollectedAmountCents: 12_000,
      paymentStatus: "paid",
      historical: false,
      adminHref: "/admin/orders/order-1",
      attribution: {
        channel: "Google Ads",
        source: "google",
        medium: "cpc",
        campaign: "spring",
      },
    }],
    total: 26,
    page: 1,
    pageSize: 25,
    pageCount: 2,
    ...overrides,
  };
}

function response(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

describe("WebsiteAnalyticsV2Dashboard", () => {
  beforeEach(() => {
    navigation.search = "scope=all_business";
    navigation.replace.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders every KPI, separated currencies, notices, unavailable metrics and order drill-down", async () => {
    render(<WebsiteAnalyticsV2Dashboard
      initialData={dashboardData()}
      initialOrders={orderData()}
      initialQueryString="scope=all_business"
    />);

    const kpis = screen.getByLabelText("Key performance indicators");
    for (const label of [
      "Visitors", "Sessions", "Page Views", "Inquiries", "Orders", "Paid Orders",
      "Inquiry Conversion", "Order Conversion", "Paid Order Conversion",
    ]) expect(within(kpis).getByText(label)).toBeInTheDocument();
    expect(within(kpis).getByText("—")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "NZD" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AUD" })).toBeInTheDocument();
    expect(screen.getByText("NZD:24000")).toBeInTheDocument();
    expect(screen.getByText("AUD:50000")).toBeInTheDocument();
    expect(screen.getByText("Traffic and funnel metrics remain Website-only in All Business scope."))
      .toBeInTheDocument();
    expect(screen.getByText(/Last touch uses the latest non-direct visit/)).toBeInTheDocument();
    expect(screen.getByText("Entrances: unavailable")).toBeInTheDocument();
    expect(screen.getByText("Exits: unavailable")).toBeInTheDocument();
    expect(screen.getByText("Assists: unavailable")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "RNR-001" })).toHaveAttribute("href", "/admin/orders/order-1");
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next orders page" })).toBeEnabled();
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith(
      `/admin/analytics?${canonicalQuery}`,
      { scroll: false },
    ));
  });

  it("uses router.replace plus abortable API reads and shows loading then fresh data", async () => {
    const dashboardRequest = deferred<Response>();
    const ordersRequest = deferred<Response>();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(dashboardRequest.promise)
      .mockReturnValueOnce(ordersRequest.promise);
    vi.stubGlobal("fetch", fetchMock);
    const documentUrl = window.location.href;
    render(<WebsiteAnalyticsV2Dashboard
      initialData={dashboardData()}
      initialOrders={orderData()}
      initialQueryString="scope=all_business"
    />);
    navigation.replace.mockClear();

    fireEvent.change(screen.getByRole("combobox", { name: "Business scope" }), {
      target: { value: "website" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    expect(screen.getByRole("status", { name: "Loading analytics" })).toBeInTheDocument();
    expect(navigation.replace).toHaveBeenCalledWith(
      expect.stringContaining("/admin/analytics?preset=custom"),
      { scroll: false },
    );
    expect(window.location.href).toBe(documentUrl);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/api/admin/analytics?");
    expect(String(fetchMock.mock.calls[1]![0])).toContain("/api/admin/analytics/orders?");
    const signal = (fetchMock.mock.calls[0]![1] as RequestInit).signal;
    expect(signal).toBeInstanceOf(AbortSignal);

    const nextData = dashboardData({
      filters: { ...dashboardData().filters, scope: "website" },
      kpis: { ...dashboardData().kpis, sessions: 99 },
    });
    dashboardRequest.resolve(await response(nextData));
    ordersRequest.resolve(await response(orderData({ total: 1, pageCount: 1 })));

    await waitFor(() => expect(screen.getByText("99", { selector: "strong" })).toBeInTheDocument());
    expect(screen.queryByRole("status", { name: "Loading analytics" })).not.toBeInTheDocument();
  });

  it("aborts superseded reads and rejects their stale responses", async () => {
    const requests = Array.from({ length: 4 }, () => deferred<Response>());
    let requestIndex = 0;
    const fetchMock = vi.fn().mockImplementation(() => requests[requestIndex++]!.promise);
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<WebsiteAnalyticsV2Dashboard
      initialData={dashboardData()}
      initialOrders={orderData()}
      initialQueryString="scope=all_business"
    />);

    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    const firstSignal = (fetchMock.mock.calls[0]![1] as RequestInit).signal as AbortSignal;
    navigation.search = canonicalQuery.replace("scope=all_business", "scope=website");
    view.rerender(<WebsiteAnalyticsV2Dashboard
      initialData={dashboardData()}
      initialOrders={orderData()}
      initialQueryString="scope=all_business"
    />);

    expect(firstSignal.aborted).toBe(true);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const activeDashboard = dashboardData({ kpis: { ...dashboardData().kpis, sessions: 77 } });
    const staleDashboard = dashboardData({ kpis: { ...dashboardData().kpis, sessions: 13 } });
    requests[2]!.resolve(await response(activeDashboard));
    requests[3]!.resolve(await response(orderData({ total: 1, pageCount: 1 })));
    await waitFor(() => expect(screen.getByText("77", { selector: "strong" })).toBeInTheDocument());

    requests[0]!.resolve(await response(staleDashboard));
    requests[1]!.resolve(await response(orderData()));
    await Promise.resolve();
    expect(screen.getByText("77", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByText("13", { selector: "strong" })).not.toBeInTheDocument();
  });

  it("cancels a pending replacement when history returns to the displayed query", async () => {
    const dashboardRequest = deferred<Response>();
    const ordersRequest = deferred<Response>();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(dashboardRequest.promise)
      .mockReturnValueOnce(ordersRequest.promise);
    vi.stubGlobal("fetch", fetchMock);
    navigation.search = canonicalQuery;
    const view = render(<WebsiteAnalyticsV2Dashboard
      initialData={dashboardData()}
      initialOrders={orderData()}
      initialQueryString={canonicalQuery}
    />);

    fireEvent.change(screen.getByRole("combobox", { name: "Business scope" }), {
      target: { value: "website" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    const pendingSignal = (fetchMock.mock.calls[0]![1] as RequestInit).signal as AbortSignal;
    const replacementQuery = canonicalQuery.replace("scope=all_business", "scope=website");
    navigation.search = replacementQuery;
    view.rerender(<WebsiteAnalyticsV2Dashboard
      initialData={dashboardData()}
      initialOrders={orderData()}
      initialQueryString={canonicalQuery}
    />);

    navigation.search = canonicalQuery;
    view.rerender(<WebsiteAnalyticsV2Dashboard
      initialData={dashboardData()}
      initialOrders={orderData()}
      initialQueryString={canonicalQuery}
    />);

    expect(pendingSignal.aborted).toBe(true);
    await waitFor(() => expect(screen.queryByRole("status", { name: "Loading analytics" }))
      .not.toBeInTheDocument());

    dashboardRequest.resolve(await response(dashboardData({
      filters: { ...dashboardData().filters, scope: "website", canonicalQuery: replacementQuery },
      kpis: { ...dashboardData().kpis, sessions: 91 },
    })));
    ordersRequest.resolve(await response(orderData()));
    await Promise.resolve();
    expect(screen.getByText("12", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByText("91", { selector: "strong" })).not.toBeInTheDocument();
  });

  it("shows a no-data state and recovers from an API error through Retry", async () => {
    const empty = dashboardData({
      kpis: {
        visitors: 0,
        sessions: 0,
        pageViews: 0,
        inquiries: 0,
        orders: 0,
        paidOrders: 0,
        inquiryConversionRate: null,
        orderConversionRate: null,
        paidOrderConversionRate: null,
        money: [],
      },
      timeseries: [],
      channels: [],
      campaigns: [],
      pages: { items: [], available: true, coverageFrom: "2026-08-01", unavailableMetrics: ["entrances", "exits", "assists"] },
      payments: [],
      markets: [],
      countries: [],
    });
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response({ error: "Unavailable" }, 500))
      .mockImplementationOnce(() => response(orderData()))
      .mockImplementationOnce(() => response(dashboardData({ kpis: { ...dashboardData().kpis, sessions: 55 } })))
      .mockImplementationOnce(() => response(orderData()));
    vi.stubGlobal("fetch", fetchMock);
    render(<WebsiteAnalyticsV2Dashboard
      initialData={empty}
      initialOrders={orderData({ items: [], total: 0, pageCount: 0 })}
      initialQueryString="scope=all_business"
    />);

    expect(screen.getByText("No analytics data for this period.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("Analytics could not be loaded");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("55", { selector: "strong" })).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reloads from the URL when browser back or forward changes search params", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response(dashboardData({
        filters: { ...dashboardData().filters, scope: "website" },
        kpis: { ...dashboardData().kpis, sessions: 44 },
      })))
      .mockImplementationOnce(() => response(orderData({ total: 1, pageCount: 1 })));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<WebsiteAnalyticsV2Dashboard
      initialData={dashboardData()}
      initialOrders={orderData()}
      initialQueryString="scope=all_business"
    />);

    navigation.search = canonicalQuery.replace("scope=all_business", "scope=website");
    view.rerender(<WebsiteAnalyticsV2Dashboard
      initialData={dashboardData()}
      initialOrders={orderData()}
      initialQueryString="scope=all_business"
    />);

    await waitFor(() => expect(screen.getByText("44", { selector: "strong" })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
