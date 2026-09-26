import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExplorerSessionsResponse, ExplorerVisitorResponse } from "@/domain/analytics/website-analytics-explorer";
import { WebsiteAnalyticsV2Explorer } from "./website-analytics-v2-explorer";

const visitorId = "a".repeat(64);
const sessionId = "00000000-0000-4000-8000-000000000001";
const query = "preset=custom&from=2026-09-01&to=2026-09-27&scope=website&attribution=last_touch&page=4&pageSize=50&sort=ordered_amount_desc&path=%2Fcart";
const session = {
  sessionId, visitorId, startedAt: "2026-09-27T00:00:00.000Z", lastSeenAt: "2026-09-27T00:02:00.000Z",
  countryCode: "NZ", channel: "google_ads", source: "google", medium: "cpc", campaign: "Spring",
  clickIdType: "gclid", entryPage: "/", exitPage: "/cart", pageViews: 2, sessionPageViews: 2, observedDurationSeconds: 120,
  singlePage: false, product: false, cart: true, checkout: null, orders: 0, paidOrders: 0, money: [],
  matchedPage: { occurredAt: "2026-09-27T00:02:00.000Z", pathname: "/cart", previousPage: "/", nextPage: null },
} as const;
const metadata = { timezone: "Pacific/Auckland", coverageFrom: "2026-09-01", completeRange: true,
  trafficBasis: "session_acquisition", durationBasis: "first_to_last_recorded_pageview",
  conversionBasis: "converting_session_as_of_range_end" } as const;
const data: ExplorerSessionsResponse = {
  items: [session], total: 26, page: 1, pageSize: 25, pageCount: 2,
  summary: { visitors: 1, sessions: 1, pageViews: 2, pagesPerSession: 2, singlePageSessions: 0,
    multiPageSessions: 1, singlePageRate: 0, observedReturningVisitors: 0, observedNewVisitors: 1,
    avgObservedDurationSeconds: 120, productSessions: 0, cartSessions: 1, checkoutSessions: null,
    orderSessions: 0, paidSessions: 0, orders: 0, paidOrders: 0, money: [] },
  acquisition: [], metadata, notices: [],
};
const detail: ExplorerVisitorResponse = {
  visitor: { visitorId, firstSeenAt: session.startedAt, lastSeenAt: session.lastSeenAt, sessionCount: 1, observedReturning: false },
  sessions: [{ ...session, pageviews: [
    { id: "p1", occurredAt: session.startedAt, pathname: "/", previousPage: null, nextPage: "/cart" },
    { id: "p2", ...session.matchedPage },
  ], conversions: [{ conversionId: "c1", orderId: "o1", orderNumber: "08008", adminHref: "/admin/orders/o1",
    occurredAt: "2026-09-27T00:03:00.000Z", orderedAmountCents: 12000, currency: "NZD", paymentStatus: "paid",
    paidAt: "2026-09-27T00:04:00.000Z", attribution: { model: "last_touch", channel: "google_ads", source: "google", medium: "cpc", campaign: "Spring" },
    orderAcquisition: { clickIds: [{ type: "gclid", value: "example-click-id" }], firstTouch: null, lastTouch: null, lastNonDirectTouch: null },
  }], financialEvents: [{ id: "f1", orderId: "o1", occurredAt: "2026-09-27T00:04:00.000Z", type: "receipt", amountCents: 12000, currency: "NZD" }], pageviewsTotal: 2, pageviewsTruncated: false }],
  total: 1, page: 1, pageSize: 25, pageCount: 1, truncated: false, metadata, notices: [],
};
function response(body: unknown) { return Promise.resolve(new Response(JSON.stringify(body), { status: 200 })); }
afterEach(() => vi.unstubAllGlobals());

describe("WebsiteAnalyticsV2Explorer", () => {
  it("shows distinct counts and Cart neighbors with unavailable checkout preserved", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => response(data)));
    render(<WebsiteAnalyticsV2Explorer canonicalQuery={query} onNavigate={vi.fn()} />);
    const table = await screen.findByRole("table", { name: "Visitor sessions" });
    expect(within(table).getByText("google / cpc")).toBeInTheDocument();
    expect(within(table).getByText("Spring")).toBeInTheDocument();
    expect(within(table).getByText("Not recorded")).toBeInTheDocument();
    expect(screen.getByLabelText("Session quality")).toHaveTextContent("Visitors1Sessions1Pageviews2");
    expect(within(table).getByText("Previous: /")).toBeInTheDocument();
  });

  it("preserves order filters through search, session sorting and pagination", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => response(data)));
    const navigate = vi.fn();
    render(<WebsiteAnalyticsV2Explorer canonicalQuery={query} onNavigate={navigate} />);
    await screen.findByRole("table", { name: "Visitor sessions" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search visitors or sessions" }), { target: { value: "08008" } });
    fireEvent.click(screen.getByRole("button", { name: "Search sessions" }));
    let result = new URLSearchParams(navigate.mock.calls.at(-1)![0]);
    expect(result.get("q")).toBe("08008");
    expect(result.get("page")).toBe("4");
    expect(result.get("pageSize")).toBe("50");
    expect(result.get("sort")).toBe("ordered_amount_desc");
    fireEvent.change(screen.getByRole("combobox", { name: "Sort sessions" }), { target: { value: "pageviews_desc" } });
    result = new URLSearchParams(navigate.mock.calls.at(-1)![0]);
    expect(result.get("trafficSort")).toBe("pageviews_desc");
    expect(result.get("trafficPage")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next sessions page" }));
    result = new URLSearchParams(navigate.mock.calls.at(-1)![0]);
    expect(result.get("trafficPage")).toBe("2");
    expect(result.get("page")).toBe("4");
  });

  it("opens a visitor journey with ordered page/order/payment evidence and full IDs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => response(url.includes("/visitors/") ? detail : data)));
    const navigate = vi.fn();
    const view = render(<WebsiteAnalyticsV2Explorer canonicalQuery={query} onNavigate={navigate} />);
    const visitorButton = await screen.findByRole("button", { name: `View visitor ${visitorId}` });
    fireEvent.click(visitorButton);
    const nextQuery = navigate.mock.calls.at(-1)![0] as string;
    view.rerender(<WebsiteAnalyticsV2Explorer canonicalQuery={nextQuery} onNavigate={navigate} />);
    const dialog = await screen.findByRole("dialog", { name: "Visitor journey" });
    await within(dialog).findByText(visitorId);
    expect(within(dialog).getByText(sessionId)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Order 08008 created" })).toHaveAttribute("href", "/admin/orders/o1");
    expect(within(dialog).getByText("example-click-id")).toBeInTheDocument();
    const timeline = within(dialog).getByRole("list", { name: "Session journey" });
    expect(timeline.children[0]).toHaveTextContent("/");
    expect(timeline.children[1]).toHaveTextContent("/cart");
    expect(timeline.children[2]).toHaveTextContent("Order 08008 created");
    expect(timeline.children[3]).toHaveTextContent("Payment received");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(new URLSearchParams(navigate.mock.calls.at(-1)![0]).has("visitor")).toBe(false);
    view.rerender(<WebsiteAnalyticsV2Explorer canonicalQuery={query} onNavigate={navigate} />);
    expect(visitorButton).toHaveFocus();
  });

  it("shows an explicit error and retries failed session reads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("failed", { status: 500 }))
      .mockImplementation(() => response(data)));
    render(<WebsiteAnalyticsV2Explorer canonicalQuery={query} onNavigate={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Sessions could not be loaded");
    fireEvent.click(screen.getByRole("button", { name: "Retry sessions" }));
    expect(await screen.findByRole("table", { name: "Visitor sessions" })).toBeInTheDocument();
  });

  it("restores focus after a server navigation rerender loses the original button focus", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => response(url.includes("/visitors/") ? detail : data)));
    const navigate = vi.fn();
    const view = render(<WebsiteAnalyticsV2Explorer canonicalQuery={query} onNavigate={navigate} />);
    const visitorButton = await screen.findByRole("button", { name: `View visitor ${visitorId}` });
    fireEvent.click(visitorButton);
    view.rerender(<WebsiteAnalyticsV2Explorer canonicalQuery={navigate.mock.calls.at(-1)![0]} onNavigate={navigate} />);
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Visitor journey" })).getByRole("button", { name: "Close" }));
    view.rerender(<WebsiteAnalyticsV2Explorer canonicalQuery={query} onNavigate={navigate} />);
    expect(visitorButton).toHaveFocus();
    visitorButton.blur();
    expect(document.body).toHaveFocus();
    view.rerender(<WebsiteAnalyticsV2Explorer canonicalQuery={query} onNavigate={navigate} />);
    expect(screen.getByRole("button", { name: `View visitor ${visitorId}` })).toHaveFocus();

    view.rerender(<WebsiteAnalyticsV2Explorer canonicalQuery={`${query}&compare=false`} onNavigate={navigate} />);
    const replacedButton = await screen.findByRole("button", { name: `View visitor ${visitorId}` });
    expect(replacedButton).not.toBe(visitorButton);
    expect(replacedButton).toHaveFocus();

    const search = screen.getByRole("searchbox", { name: "Search visitors or sessions" });
    search.focus();
    view.rerender(<WebsiteAnalyticsV2Explorer canonicalQuery={`${query}&compare=false`} onNavigate={navigate} />);
    expect(search).toHaveFocus();
  });

  it("distinguishes a single-page visit from two sessions by the same visitor", async () => {
    const single = { ...session, pageViews: 1, singlePage: true, observedDurationSeconds: null, cart: false, entryPage: "/", exitPage: "/" };
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => response({ ...data, items: [single],
      summary: { ...data.summary, visitors: 1, sessions: 1, pageViews: 1, singlePageSessions: 1 } })));
    const view = render(<WebsiteAnalyticsV2Explorer canonicalQuery={query} onNavigate={vi.fn()} />);
    const table = await screen.findByRole("table", { name: "Visitor sessions" });
    expect(within(table).getByText("Single-page session")).toBeInTheDocument();
    expect(within(table).getByText("Not available")).toBeInTheDocument();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => response({ ...data,
      items: [{ ...session, pageViews: 3 }, { ...session, sessionId: "00000000-0000-4000-8000-000000000002", pageViews: 4 }],
      summary: { ...data.summary, visitors: 1, sessions: 2, pageViews: 7 } })));
    view.rerender(<WebsiteAnalyticsV2Explorer canonicalQuery={`${query}&q=repeat`} onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("Session quality")).toHaveTextContent("Visitors1Sessions2Pageviews7"));
    expect(within(screen.getByRole("table", { name: "Visitor sessions" })).getAllByRole("button", { name: `View visitor ${visitorId}` })).toHaveLength(2);
  });

  it("aborts stale session responses after filters change", async () => {
    let resolveOld!: (response: Response) => void;
    const oldRequest = new Promise<Response>((resolve) => { resolveOld = resolve; });
    const fetchMock = vi.fn().mockReturnValueOnce(oldRequest).mockImplementation(() => response({ ...data, items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<WebsiteAnalyticsV2Explorer canonicalQuery={query} onNavigate={vi.fn()} />);
    const signal = (fetchMock.mock.calls[0]![1] as RequestInit).signal!;
    view.rerender(<WebsiteAnalyticsV2Explorer canonicalQuery={`${query}&q=new`} onNavigate={vi.fn()} />);
    expect(signal.aborted).toBe(true);
    await screen.findByText("No retained sessions match these filters.");
    resolveOld(await response(data));
    await Promise.resolve();
    expect(screen.queryByRole("table", { name: "Visitor sessions" })).not.toBeInTheDocument();
  });

  it.each([null, "2026-09-01"])("shows unavailable instead of zero when the range has no retained coverage (%s)", async (coverageFrom) => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => response({ ...data, items: [], total: 0, pageCount: 0,
      summary: { ...data.summary, visitors: 0, sessions: 0, pageViews: 0, cartSessions: 0 },
      metadata: { ...metadata, coverageFrom, completeRange: false } })));
    render(<WebsiteAnalyticsV2Explorer canonicalQuery={query.replace("2026-09-01", "2026-08-01").replace("2026-09-27", "2026-08-31")} onNavigate={vi.fn()} />);
    await screen.findByText("Session metrics and journeys are not available for this date range.");
    expect(screen.queryByLabelText("Session quality")).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Session journey stages" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Sessions pagination" })).not.toBeInTheDocument();
    expect(screen.queryByText("No retained sessions match these filters.")).not.toBeInTheDocument();
  });

  it("labels metrics as a retained sample when only part of the selected range is covered", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => response({ ...data,
      metadata: { ...metadata, coverageFrom: "2026-09-10", completeRange: false } })));
    render(<WebsiteAnalyticsV2Explorer canonicalQuery={query} onNavigate={vi.fn()} />);
    await screen.findByText("Counts below describe the retained sample only.");
    expect(screen.getByLabelText("Session quality")).toHaveTextContent("Visitors1Sessions1Pageviews2");
  });
});
