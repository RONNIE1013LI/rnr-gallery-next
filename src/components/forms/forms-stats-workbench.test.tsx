import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FormsStatsWorkbench } from "./forms-stats-workbench";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FormsStatsWorkbench", () => {
  it("renders accessible number and category statistics", async () => {
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const url = String(input);
      const stat = url.includes("job_count")
        ? { metric: "job_count", value: 12 }
        : { metric: "status", rows: [{ label: "designing", value: 4 }, { label: "new", value: 8 }] };
      return Promise.resolve(new Response(JSON.stringify({ stat }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }));
    render(<FormsStatsWorkbench canManage={false} layouts={[{
      id: "layout-1", name: "Daily", widgets: [
        { id: "count", type: "number", metric: "job_count", title: "Orders" },
        { id: "status", type: "bar", metric: "status", title: "Order status" },
      ],
    }]} />);
    expect(await screen.findByText("12")).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "Order status data" });
    expect(within(table).getByText("designing")).toBeInTheDocument();
  });

  it("supports keyboard reordering, adding, removing and saving for managers", async () => {
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "PUT") return Promise.resolve(new Response(JSON.stringify({ layout: { id: "saved" } }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ stat: { metric: "job_count", value: 1 } }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<FormsStatsWorkbench canManage layouts={[{
      id: "layout-1", name: "Daily", widgets: [
        { id: "first", type: "number", metric: "job_count", title: "First" },
        { id: "second", type: "number", metric: "urgent_count", title: "Second" },
      ],
    }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Move Second up" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove First" }));
    fireEvent.click(screen.getByRole("button", { name: "Add widget" }));
    fireEvent.click(screen.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/forms/stats/layout", expect.objectContaining({ method: "PUT" })));
    expect(await screen.findByText("Layout saved.")).toBeInTheDocument();
  });
});
