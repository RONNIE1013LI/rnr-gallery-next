import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FormsStatsDashboardLayout } from "./forms-stats-dashboard";
import { FormsStatsDashboard } from "./forms-stats-dashboard";

const orderCountQuery = { measure: "order_count", aggregation: "count", sort: "default" } as const;
const weeklySales: FormsStatsDashboardLayout = {
  id: "weekly-sales",
  name: "Weekly sales",
  widgets: [
    { id: "orders", type: "number", title: "Orders", query: orderCountQuery },
    { id: "orders-copy", type: "number", title: "Orders again", query: orderCountQuery },
  ],
};

class SizedResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    this.callback([{ contentRect: { width: 640, height: 260 }, target } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }

  unobserve() {}

  disconnect() {}
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FormsStatsDashboard", () => {
  it("shows a full saved report and requests each canonical statistic once", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ stat: { query: orderCountQuery, value: 12 } }), { status: 200, headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("fetch", fetchMock);
    render(<FormsStatsDashboard layouts={[weeklySales]} canManage canViewFinance onCreate={vi.fn()} onEdit={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Create custom stat" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Weekly sales" })).toBeInTheDocument();
    expect(await screen.findAllByText("12")).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/forms/stats?measure=order_count&aggregation=count&sort=default", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("keeps an accepted workbench filter context in canonical statistic requests", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ stat: { query: orderCountQuery, value: 12 } }), { status: 200, headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("fetch", fetchMock);

    render(<FormsStatsDashboard
      layouts={[weeklySales]}
      canManage
      canViewFinance
      queryContext={{ q: "portrait", preset: "lastYear", match: "or", filters: ["urgent~equals~true", "status~equals~designing"] }}
      onCreate={vi.fn()}
      onEdit={vi.fn()}
      onDeleted={vi.fn()}
    />);

    await screen.findAllByText("12");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/forms/stats?measure=order_count&aggregation=count&sort=default&q=portrait&preset=lastYear&match=or&filter=urgent%7Eequals%7Etrue&filter=status%7Eequals%7Edesigning",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("shows loading while a request is pending and aborts obsolete filter requests", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      if (!init?.signal) throw new Error("Expected an abort signal.");
      signals.push(init.signal);
      return signals.length === 1 ? first.promise : second.promise;
    }));
    const { rerender } = render(<FormsStatsDashboard layouts={[weeklySales]} canManage canViewFinance queryContext={{ q: "first" }} onCreate={vi.fn()} onEdit={vi.fn()} onDeleted={vi.fn()} />);

    expect(await screen.findAllByRole("status")).toHaveLength(2);
    rerender(<FormsStatsDashboard layouts={[weeklySales]} canManage canViewFinance queryContext={{ q: "second" }} onCreate={vi.fn()} onEdit={vi.fn()} onDeleted={vi.fn()} />);
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0]!.aborted).toBe(true);

    second.resolve(new Response(JSON.stringify({ stat: { query: orderCountQuery, value: 9 } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    expect(await screen.findAllByText("9")).toHaveLength(2);
    first.resolve(new Response(JSON.stringify({ stat: { query: orderCountQuery, value: 1 } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await Promise.resolve();
    expect(screen.queryByText("1")).not.toBeInTheDocument();
  });

  it("namespaces chart descriptions when different reports reuse a widget ID", async () => {
    vi.stubGlobal("ResizeObserver", SizedResizeObserver);
    const chartWidget = { id: "status", type: "bar" as const, title: "Order status", query: { ...orderCountQuery, dimension: "status" } as const };
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      stat: { query: chartWidget.query, rows: [{ label: "Designing", value: 2 }] },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))));

    render(<FormsStatsDashboard layouts={[
      { id: "report-one", name: "First report", widgets: [chartWidget] },
      { id: "report-two", name: "Second report", widgets: [chartWidget] },
    ]} canManage canViewFinance onCreate={vi.fn()} onEdit={vi.fn()} onDeleted={vi.fn()} />);

    const charts = await screen.findAllByRole("application", { name: "Order status chart" });
    const descriptions = charts.map((chart) => chart.getAttribute("aria-describedby"));
    expect(new Set(descriptions).size).toBe(2);
    for (const description of descriptions) expect(document.getElementById(description!)).toBeInTheDocument();
  });

  it("hides management controls from viewers while keeping report data visible", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ stat: { query: orderCountQuery, value: 3 } }), { status: 200, headers: { "Content-Type": "application/json" } }))));
    render(<FormsStatsDashboard layouts={[weeklySales]} canManage={false} canViewFinance={false} onCreate={vi.fn()} onEdit={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Create custom stat" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Weekly sales" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Weekly sales" })).not.toBeInTheDocument();
    expect(await screen.findAllByText("3")).toHaveLength(2);
  });

  it("emits the selected saved layout through the edit boundary", () => {
    const onEdit = vi.fn();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ stat: { query: orderCountQuery, value: 3 } }), { status: 200, headers: { "Content-Type": "application/json" } }))));
    render(<FormsStatsDashboard layouts={[weeklySales]} canManage canViewFinance onCreate={vi.fn()} onEdit={onEdit} onDeleted={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Weekly sales" }));

    expect(onEdit).toHaveBeenCalledWith(weeklySales);
  });

  it("keeps a successful widget visible when another widget request fails", async () => {
    const deliveryQuery = { ...orderCountQuery, dimension: "delivery_method" } as const;
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => String(input).includes("dimension=delivery_method")
      ? Promise.resolve(new Response(JSON.stringify({ error: "Unavailable" }), { status: 500 }))
      : Promise.resolve(new Response(JSON.stringify({ stat: { query: orderCountQuery, value: 7 } }), { status: 200, headers: { "Content-Type": "application/json" } }))));
    render(<FormsStatsDashboard layouts={[{ ...weeklySales, widgets: [
      { id: "orders", type: "number", title: "Orders", query: orderCountQuery },
      { id: "delivery", type: "table", title: "Delivery", query: deliveryQuery },
    ] }]} canManage canViewFinance onCreate={vi.fn()} onEdit={vi.fn()} onDeleted={vi.fn()} />);
    expect(await screen.findByText("7")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Statistic unavailable.");
    expect(screen.getByRole("heading", { name: "Weekly sales" })).toBeInTheDocument();
  });

  it("confirms and encodes a successful delete before removing the report", async () => {
    const report = { ...weeklySales, name: "Weekly sales & tax" };
    const onDeleted = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => init?.method === "DELETE"
      ? Promise.resolve(new Response(JSON.stringify({ removed: true }), { status: 200 }))
      : Promise.resolve(new Response(JSON.stringify({ stat: { query: orderCountQuery, value: 1 } }), { status: 200, headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("fetch", fetchMock);
    render(<FormsStatsDashboard layouts={[report]} canManage canViewFinance onCreate={vi.fn()} onEdit={vi.fn()} onDeleted={onDeleted} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Weekly sales & tax" }));
    expect(window.confirm).toHaveBeenCalledWith('Delete "Weekly sales & tax"?');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/forms/stats/layout?name=Weekly%20sales%20%26%20tax", expect.objectContaining({ method: "DELETE" })));
    expect(onDeleted).toHaveBeenCalledWith(report);
  });

  it("retains a report and explains a failed delete", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => init?.method === "DELETE"
      ? Promise.resolve(new Response(JSON.stringify({ error: "Delete failed" }), { status: 500, headers: { "Content-Type": "application/json" } }))
      : Promise.resolve(new Response(JSON.stringify({ stat: { query: orderCountQuery, value: 1 } }), { status: 200, headers: { "Content-Type": "application/json" } }))));
    render(<FormsStatsDashboard layouts={[weeklySales]} canManage canViewFinance onCreate={vi.fn()} onEdit={vi.fn()} onDeleted={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Weekly sales" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Delete failed");
    expect(screen.getByRole("heading", { name: "Weekly sales" })).toBeInTheDocument();
  });

  it("serializes report deletion while one deletion is pending", async () => {
    const firstDelete = deferred<Response>();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const secondReport = { ...weeklySales, id: "monthly-sales", name: "Monthly sales" };
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => init?.method === "DELETE"
      ? firstDelete.promise
      : Promise.resolve(new Response(JSON.stringify({ stat: { query: orderCountQuery, value: 1 } }), { status: 200, headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("fetch", fetchMock);

    render(<FormsStatsDashboard layouts={[weeklySales, secondReport]} canManage canViewFinance onCreate={vi.fn()} onEdit={vi.fn()} onDeleted={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Weekly sales" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/forms/stats/layout?name=Weekly%20sales", expect.objectContaining({ method: "DELETE" })));
    expect(screen.getByRole("button", { name: "Delete Weekly sales" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete Monthly sales" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Delete Monthly sales" }));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE")).toHaveLength(1);

    firstDelete.resolve(new Response(JSON.stringify({ removed: true }), { status: 200 }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete Monthly sales" })).not.toBeDisabled());
  });

  it("shows an empty saved-report state while preserving create access", () => {
    render(<FormsStatsDashboard layouts={[]} canManage canViewFinance onCreate={vi.fn()} onEdit={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Create custom stat" })).toBeInTheDocument();
    expect(screen.getByText("No custom reports have been saved yet.")).toBeInTheDocument();
  });
});
