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

  it("shows an empty saved-report state while preserving create access", () => {
    render(<FormsStatsDashboard layouts={[]} canManage canViewFinance onCreate={vi.fn()} onEdit={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Create custom stat" })).toBeInTheDocument();
    expect(screen.getByText("No custom reports have been saved yet.")).toBeInTheDocument();
  });
});
