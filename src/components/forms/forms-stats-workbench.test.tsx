import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FormsStatsWorkbench } from "./forms-stats-workbench";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FormsStatsWorkbench", () => {
  it("enters the builder boundary from the create control", () => {
    render(<FormsStatsWorkbench canManage canViewFinance layouts={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Create custom stat" }));

    expect(screen.getByTestId("forms-stats-workbench")).toHaveAttribute("data-mode", "builder");
    expect(screen.getByTestId("forms-stats-workbench")).toHaveAttribute("data-layout-id", "");
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
    expect(screen.queryByRole("heading", { name: "Weekly sales" })).not.toBeInTheDocument();
  });
});
