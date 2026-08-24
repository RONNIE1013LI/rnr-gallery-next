import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FormsStatsWorkbench } from "./forms-stats-workbench";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FormsStatsWorkbench", () => {
  it("uses one compact title-and-action toolbar", () => {
    render(<FormsStatsWorkbench canManage canViewFinance layouts={[]} />);

    expect(screen.getByRole("heading", { name: "Custom stats", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create custom stat" })).toBeInTheDocument();
    expect(screen.queryByText("Create a custom report")).not.toBeInTheDocument();
  });

  it("opens the real custom report builder from the create control and returns on Back", () => {
    render(<FormsStatsWorkbench canManage canViewFinance layouts={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Create custom stat" }));

    expect(screen.getByTestId("forms-stats-workbench")).toHaveAttribute("data-mode", "builder");
    expect(screen.getByTestId("forms-stats-workbench")).toHaveAttribute("data-layout-id", "");
    expect(screen.getByRole("heading", { name: "Custom report builder" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("forms-stats-workbench")).toHaveAttribute("data-mode", "dashboard");
    expect(screen.getByRole("button", { name: "Create custom stat" })).toBeInTheDocument();
  });

  it("passes the selected saved layout through the edit boundary and enters builder mode", () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ stat: { metric: "job_count", value: 12 } }), { status: 200, headers: { "Content-Type": "application/json" } }))));
    render(<FormsStatsWorkbench canManage canViewFinance layouts={[{
      id: "weekly-sales",
      name: "Weekly sales",
      widgets: [{ id: "orders", type: "number", title: "Orders", metric: "job_count" }],
    }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Weekly sales" }));
    expect(screen.getByTestId("forms-stats-workbench")).toHaveAttribute("data-mode", "builder");
    expect(screen.getByRole("heading", { name: "Custom report builder" })).toBeInTheDocument();
    expect(screen.getByLabelText("Report name")).toHaveValue("Weekly sales");
  });

  it("returns to the dashboard with the server-saved layout only after Save succeeds", async () => {
    let nextId = 0;
    vi.stubGlobal("crypto", { randomUUID: () => `widget-${++nextId}` });
    vi.stubGlobal("fetch", vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return Promise.resolve(new Response(JSON.stringify({ layout: { id: "00000000-0000-4000-8000-000000000001" } }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      return Promise.resolve(new Response(JSON.stringify({ stat: { query: { measure: "order_count", aggregation: "count", sort: "default" }, value: 4 } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }));
    render(<FormsStatsWorkbench canManage canViewFinance layouts={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Create custom stat" }));
    fireEvent.change(screen.getByLabelText("Report name"), { target: { value: "Saved report" } });
    fireEvent.click(screen.getByRole("button", { name: "Add number" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { name: "Saved report" })).toBeInTheDocument();
    expect(screen.getByTestId("forms-stats-workbench")).toHaveAttribute("data-mode", "dashboard");
    expect(await screen.findByText("4")).toBeInTheDocument();
  });

  it("saves an edit under its immutable original name and replaces the existing report", async () => {
    const layoutId = "00000000-0000-4000-8000-000000000002";
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => init?.method === "PUT"
      ? Promise.resolve(new Response(JSON.stringify({ layout: { id: layoutId } }), { status: 200, headers: { "Content-Type": "application/json" } }))
      : Promise.resolve(new Response(JSON.stringify({ stat: { metric: "job_count", value: 12 } }), { status: 200, headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("fetch", fetchMock);
    render(<FormsStatsWorkbench canManage canViewFinance layouts={[{
      id: layoutId,
      name: "Weekly sales",
      widgets: [{ id: "orders", type: "number", title: "Orders", metric: "job_count" }],
    }]} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Weekly sales" }));
    expect(screen.getByLabelText("Report name")).toHaveAttribute("readonly");
    fireEvent.change(screen.getByLabelText("Report name"), { target: { value: "Renamed report" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { name: "Weekly sales" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Renamed report" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Weekly sales" })).toHaveLength(1);
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({ name: "Weekly sales" });
  });

  it("keeps the builder open when saving fails", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "widget-1" });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: "Could not save" }), { status: 500, headers: { "Content-Type": "application/json" } }))));
    render(<FormsStatsWorkbench canManage canViewFinance layouts={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Create custom stat" }));
    fireEvent.change(screen.getByLabelText("Report name"), { target: { value: "Unsaved report" } });
    fireEvent.click(screen.getByRole("button", { name: "Add number" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save");
    expect(screen.getByTestId("forms-stats-workbench")).toHaveAttribute("data-mode", "builder");
    expect(screen.getByLabelText("Report name")).toHaveValue("Unsaved report");
  });

  it("reconciles saved reports when the server layouts prop changes", async () => {
    const { rerender } = render(<FormsStatsWorkbench canManage canViewFinance layouts={[{
      id: "weekly-sales",
      name: "Weekly sales",
      widgets: [],
    }]} />);

    rerender(<FormsStatsWorkbench canManage canViewFinance layouts={[{
      id: "monthly-sales",
      name: "Monthly sales",
      widgets: [],
    }]} />);

    expect(await screen.findByRole("heading", { name: "Monthly sales" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Weekly sales" })).not.toBeInTheDocument();
  });
});
