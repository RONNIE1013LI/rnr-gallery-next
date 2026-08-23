import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import FormsStatsPage from "./page";

const { requireFormsPage, list } = vi.hoisted(() => ({
  requireFormsPage: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/server/forms/require-forms-page", () => ({ requireFormsPage }));
vi.mock("@/server/db/client", () => ({ getDatabase: () => ({}) }));
vi.mock("@/server/forms/drizzle-forms-stats-layout-repository", () => ({ listFormStatsLayouts: list }));
vi.mock("@/components/forms/forms-stats-workbench", () => ({
  FormsStatsWorkbench: ({ layouts, canManage, queryContext }: { layouts: unknown[]; canManage: boolean; queryContext?: unknown }) => <div data-testid="stats" data-layouts={layouts.length} data-manage={String(canManage)} data-query-context={JSON.stringify(queryContext)} />,
}));

describe("forms stats page", () => {
  it("gates statistics and passes validated operator layouts", async () => {
    requireFormsPage.mockResolvedValue({
      user: { id: "manager-1" }, formRole: "admin",
      formProfile: null,
    });
    list.mockResolvedValue([{
      id: "layout-1", name: "Daily",
      widgets: [{ id: "w1", type: "number", metric: "job_count", title: "Orders" }],
    }]);
    render(await FormsStatsPage({ searchParams: Promise.resolve({
      q: "portrait",
      preset: "lastYear",
      match: "or",
      filter: ["urgent~equals~true", "status~equals~designing"],
      untrusted: "ignore-me",
    }) }));
    expect(requireFormsPage).toHaveBeenCalledWith("/order-system/stats", "view_stats");
    expect(screen.getByRole("heading", { name: "Custom stats" })).toBeInTheDocument();
    expect(screen.getByTestId("stats")).toHaveAttribute("data-layouts", "1");
    expect(screen.getByTestId("stats")).toHaveAttribute("data-manage", "true");
    expect(screen.getByTestId("stats")).toHaveAttribute("data-query-context", JSON.stringify({
      q: "portrait",
      preset: "lastYear",
      match: "or",
      filters: ["urgent~equals~true", "status~equals~designing"],
    }));
  });
});
