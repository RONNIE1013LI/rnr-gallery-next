import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FormsPortalLayout from "../layout";
import FormsStatsPage, { metadata } from "./page";

const { headers, requireFormsPage, list, workbench } = vi.hoisted(() => ({
  headers: vi.fn(),
  requireFormsPage: vi.fn(),
  list: vi.fn(),
  workbench: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers }));
vi.mock("@/server/forms/require-forms-page", () => ({ requireFormsPage }));
vi.mock("@/server/db/client", () => ({ getDatabase: () => ({}) }));
vi.mock("@/server/forms/drizzle-forms-stats-layout-repository", () => ({ listFormStatsLayouts: list }));
vi.mock("@/components/forms/forms-stats-workbench", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/forms/forms-stats-workbench")>();
  return {
    FormsStatsWorkbench: (props: Parameters<typeof actual.FormsStatsWorkbench>[0]) => {
      workbench(props);
      const Component = actual.FormsStatsWorkbench;
      return <Component {...props} />;
    },
  };
});

describe("forms stats page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    headers.mockResolvedValue(new Headers({
      "x-rnr-request-path": "/order-system/stats",
    }));
    requireFormsPage.mockResolvedValue({
      user: { id: "manager-1", name: "Manager" }, formRole: "admin",
      formProfile: null,
    });
  });

  it("retains stored reports while skipping invalid widgets with visible warnings", async () => {
    list.mockResolvedValue([
      {
        id: "layout-1", name: "Daily",
        widgets: [
          { id: "w1", type: "text", title: "Summary", text: "Daily production snapshot" },
          { id: "w2", type: "sql", title: "Unsafe", query: "select *" },
        ],
      },
      {
        id: "layout-invalid", name: "Legacy report",
        widgets: [{ id: "w3", type: "sql", title: "Unsafe", query: "select *" }],
      },
    ]);
    const page = await FormsStatsPage({ searchParams: Promise.resolve({
      q: "portrait",
      preset: "lastYear",
      match: "or",
      filter: ["urgent~equals~true", "status~equals~designing"],
      untrusted: "ignore-me",
    }) });

    render(await FormsPortalLayout({ children: page }));

    expect(metadata).toEqual({ title: "Custom stats" });
    expect(requireFormsPage).toHaveBeenNthCalledWith(1, "/order-system/stats", "view_stats");
    expect(requireFormsPage).toHaveBeenNthCalledWith(2, "/order-system/stats", "access_forms");
    expect(workbench).toHaveBeenCalledWith(expect.objectContaining({
      layouts: [
        {
          id: "layout-1", name: "Daily",
          widgets: [{ id: "w1", type: "text", title: "Summary", text: "Daily production snapshot" }],
          skippedWidgetCount: 1,
          warning: "1 stale widget was skipped.",
        },
        {
          id: "layout-invalid", name: "Legacy report", widgets: [],
          skippedWidgetCount: 1,
          warning: "1 stale widget was skipped.",
        },
      ],
      canManage: true,
      canViewFinance: true,
      queryContext: {
        q: "portrait",
        preset: "lastYear",
        match: "or",
        filters: ["urgent~equals~true", "status~equals~designing"],
      },
    }));

    expect(screen.getByRole("heading", { name: "Custom stats" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Forms workspace" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Data list" })).toHaveAttribute("href", "/order-system");
    expect(screen.getByRole("link", { name: "Custom stats" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Create custom stat" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Daily" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Legacy report" })).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(screen.getAllByText("1 stale widget was skipped.")).toHaveLength(2);
  });
});
