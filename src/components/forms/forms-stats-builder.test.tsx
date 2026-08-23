import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FormsStatsDashboardLayout } from "./forms-stats-dashboard";
import { FormsStatsBuilder } from "./forms-stats-builder";

const randomUUID = vi.fn();

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  let nextId = 0;
  randomUUID.mockClear();
  randomUUID.mockImplementation(() => `widget-${++nextId}`);
  vi.stubGlobal("crypto", { randomUUID });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FormsStatsBuilder", () => {
  it("renders all seven keyboard-usable palette controls and adds click and dropped widgets with stable UUIDs", () => {
    render(<FormsStatsBuilder initialLayout={null} canViewFinance onBack={vi.fn()} onSaved={vi.fn()} />);

    for (const name of ["Add bar chart", "Add pie chart", "Add line chart", "Add table", "Add number", "Add divider", "Add text"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole("button", { name: "Add line chart" }));
    const lineHeading = within(screen.getByRole("region", { name: "Report canvas" })).getByRole("heading", { name: "Line chart" });
    expect(lineHeading.closest("article")).toHaveAttribute("data-widget-id", "widget-1");

    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => "pie"),
      effectAllowed: "move",
      dropEffect: "move",
    };
    fireEvent.dragStart(screen.getByRole("button", { name: "Add pie chart" }), { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith("text/plain", "pie");
    fireEvent.drop(screen.getByRole("region", { name: "Report canvas" }), { dataTransfer });
    const pieHeading = within(screen.getByRole("region", { name: "Report canvas" })).getByRole("heading", { name: "Pie chart" });
    expect(pieHeading.closest("article")).toHaveAttribute("data-widget-id", "widget-2");
    expect(randomUUID).toHaveBeenCalledTimes(2);
  });

  it("selects, reorders, and removes controls without a pointer-only path", () => {
    render(<FormsStatsBuilder initialLayout={null} canViewFinance onBack={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add number" }));
    fireEvent.click(screen.getByRole("button", { name: "Add text" }));

    fireEvent.click(screen.getByRole("button", { name: "Move Text up, widget 2 of 2" }));
    const canvas = screen.getByRole("region", { name: "Report canvas" });
    expect(within(canvas).getAllByRole("article").map((item) => item.getAttribute("data-widget-type"))).toEqual(["text", "number"]);

    fireEvent.click(screen.getByRole("button", { name: "Select Number, widget 2 of 2" }));
    expect(screen.getByRole("button", { name: "Select Number, widget 2 of 2" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Widget title")).toHaveValue("Number");
    fireEvent.click(screen.getByRole("button", { name: "Remove Number, widget 2 of 2" }));
    expect(within(canvas).queryByRole("heading", { name: "Number" })).not.toBeInTheDocument();
    expect(screen.getByText("Select a control to change its settings.")).toBeInTheDocument();
  });

  it("distinguishes duplicate titles by position and updates labels after reorder", () => {
    render(<FormsStatsBuilder initialLayout={null} canViewFinance onBack={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add number" }));
    fireEvent.click(screen.getByRole("button", { name: "Add number" }));

    const first = screen.getByRole("button", { name: "Select Number, widget 1 of 2" });
    const second = screen.getByRole("button", { name: "Select Number, widget 2 of 2" });
    expect(first.closest("article")).toHaveAttribute("data-widget-id", "widget-1");
    expect(second.closest("article")).toHaveAttribute("data-widget-id", "widget-2");

    fireEvent.click(screen.getByRole("button", { name: "Move Number up, widget 2 of 2" }));
    expect(screen.getByRole("button", { name: "Select Number, widget 1 of 2" }).closest("article")).toHaveAttribute("data-widget-id", "widget-2");
    expect(screen.getByRole("button", { name: "Select Number, widget 2 of 2" }).closest("article")).toHaveAttribute("data-widget-id", "widget-1");
  });

  it("guards dirty Back while a pristine draft returns immediately", () => {
    const onBack = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<FormsStatsBuilder initialLayout={null} canViewFinance onBack={onBack} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(onBack).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Report name"), { target: { value: "Weekly sales" } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(confirm).toHaveBeenCalledWith("Discard unsaved report changes?");
    expect(onBack).toHaveBeenCalledTimes(1);

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it("previews through the dashboard canonical query context without saving a layout", async () => {
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "PUT") throw new Error("Preview must not save.");
      return Promise.resolve(jsonResponse({
        stat: {
          query: { dimension: "submitted_at", timeUnit: "week", measure: "amount_payable", aggregation: "sum", sort: "default" },
          rows: [{ label: "2026 W34", value: 697106 }],
        },
      }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<FormsStatsBuilder
      initialLayout={null}
      canViewFinance
      queryContext={{ q: "portrait", preset: "lastYear", match: "or", filters: ["urgent~equals~true"] }}
      onBack={vi.fn()}
      onSaved={vi.fn()}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Add line chart" }));
    fireEvent.change(screen.getByLabelText("X axis"), { target: { value: "submitted_at" } });
    fireEvent.change(screen.getByLabelText("Time unit"), { target: { value: "week" } });
    fireEvent.change(screen.getByLabelText("Y axis"), { target: { value: "amount_payable" } });
    fireEvent.change(screen.getByLabelText("Aggregation"), { target: { value: "sum" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(await screen.findByText("2026 W34")).toBeInTheDocument();
    expect(screen.getByText("$6,971.06")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/forms/stats?dimension=submitted_at&timeUnit=week&measure=amount_payable&aggregation=sum&sort=default&q=portrait&preset=lastYear&match=or&filter=urgent%7Eequals%7Etrue",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PUT")).toBe(false);
  });

  it("aborts an obsolete preview request when the draft changes", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).startsWith("/api/forms/stats?")) throw new Error("Expected a statistic request.");
      if (!init?.signal) throw new Error("Expected a preview abort signal.");
      signals.push(init.signal);
      return new Promise<Response>(() => undefined);
    }));
    render(<FormsStatsBuilder initialLayout={null} canViewFinance onBack={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Add number" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0]!.aborted).toBe(false);

    fireEvent.change(screen.getByLabelText("Widget title"), { target: { value: "Updated total" } });
    await waitFor(() => expect(signals[0]!.aborted).toBe(true));
    expect(screen.getByText("Select Preview to load this statistic.")).toBeInTheDocument();
  });

  it("validates then saves only name and widgets, returning after the protected PUT succeeds", async () => {
    const pending = Promise.withResolvers<Response>();
    const fetchMock = vi.fn<typeof fetch>(() => pending.promise);
    const onSaved = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<FormsStatsBuilder initialLayout={null} canViewFinance onBack={vi.fn()} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText("Report name"), { target: { value: "Order totals" } });
    fireEvent.click(screen.getByRole("button", { name: "Add number" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSaved).not.toHaveBeenCalled();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/forms/stats/layout");
    expect(init).toMatchObject({ method: "PUT", headers: { "Content-Type": "application/json" } });
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "Order totals",
      widgets: [{
        id: "widget-1",
        type: "number",
        title: "Number",
        query: { measure: "order_count", aggregation: "count", sort: "default" },
      }],
    });

    pending.resolve(jsonResponse({ layout: { id: "00000000-0000-4000-8000-000000000001" } }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({
      id: "00000000-0000-4000-8000-000000000001",
      name: "Order totals",
      widgets: [expect.objectContaining({ id: "widget-1", type: "number" })],
    }));
  });

  it("locks every draft and navigation path for the complete save transaction", async () => {
    const pending = Promise.withResolvers<Response>();
    const fetchMock = vi.fn<typeof fetch>(() => pending.promise);
    const onBack = vi.fn();
    const onSaved = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<FormsStatsBuilder initialLayout={null} canViewFinance onBack={onBack} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText("Report name"), { target: { value: "Locked report" } });
    fireEvent.click(screen.getByRole("button", { name: "Add number" }));
    fireEvent.click(screen.getByRole("button", { name: "Add text" }));
    fireEvent.click(screen.getByRole("button", { name: "Select Number, widget 1 of 2" }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("region", { name: "Custom report builder" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status", { name: "Saving report" })).toHaveTextContent("Saving report…");
    expect(screen.getByLabelText("Report name")).toBeDisabled();
    expect(screen.getByLabelText("Widget title")).toBeDisabled();
    for (const name of ["Add bar chart", "Add pie chart", "Add line chart", "Add table", "Add number", "Add divider", "Add text"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
      expect(screen.getByRole("button", { name })).toHaveAttribute("draggable", "false");
    }
    for (const name of [
      "Select Number, widget 1 of 2", "Move Number up, widget 1 of 2", "Move Number down, widget 1 of 2", "Remove Number, widget 1 of 2",
      "Back", "Preview", "Save",
    ]) expect(screen.getByRole("button", { name })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Report name"), { target: { value: "Changed" } });
    fireEvent.change(screen.getByLabelText("Widget title"), { target: { value: "Changed widget" } });
    fireEvent.click(screen.getByRole("button", { name: "Add number" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Number, widget 1 of 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const dataTransfer = { setData: vi.fn(), getData: vi.fn(() => "pie"), effectAllowed: "move", dropEffect: "move" };
    fireEvent.dragStart(screen.getByRole("button", { name: "Add pie chart" }), { dataTransfer });
    fireEvent.drop(screen.getByRole("region", { name: "Report canvas" }), { dataTransfer });

    expect(screen.getByLabelText("Report name")).toHaveValue("Locked report");
    expect(screen.getByLabelText("Widget title")).toHaveValue("Number");
    expect(within(screen.getByRole("region", { name: "Report canvas" })).getAllByRole("article")).toHaveLength(2);
    expect(onBack).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    pending.resolve(jsonResponse({ layout: { id: "00000000-0000-4000-8000-000000000001" } }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("aborts an in-flight save on unmount and ignores its stale success", async () => {
    const pending = Promise.withResolvers<Response>();
    let signal: AbortSignal | undefined;
    const onSaved = vi.fn();
    vi.stubGlobal("fetch", vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return pending.promise;
    }));
    const { unmount } = render(<FormsStatsBuilder initialLayout={null} canViewFinance onBack={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText("Report name"), { target: { value: "Unmounted report" } });
    fireEvent.click(screen.getByRole("button", { name: "Add number" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));

    unmount();
    expect(signal!.aborted).toBe(true);
    pending.resolve(jsonResponse({ layout: { id: "00000000-0000-4000-8000-000000000001" } }));
    await Promise.resolve();
    await Promise.resolve();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", {}],
    ["empty", { id: "" }],
    ["non-UUID", { id: "saved-layout" }],
  ])("retains the draft when a 2xx save response has a %s layout id", async (_case, layout) => {
    const onSaved = vi.fn();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({ layout }))));
    render(<FormsStatsBuilder initialLayout={null} canViewFinance onBack={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText("Report name"), { target: { value: "Response check" } });
    fireEvent.click(screen.getByRole("button", { name: "Add number" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The saved report response was invalid. Try saving again.");
    expect(screen.getByLabelText("Report name")).toHaveValue("Response check");
    expect(screen.getByRole("heading", { name: "Number" })).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("rejects an invalid draft before PUT and retains a failed-save draft for retry", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ error: "Save failed" }, 500)));
    const onSaved = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<FormsStatsBuilder initialLayout={null} canViewFinance onBack={vi.fn()} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a report name and check every control setting.");
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Report name"), { target: { value: "Retry report" } });
    fireEvent.click(screen.getByRole("button", { name: "Add number" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
    expect(screen.getByLabelText("Report name")).toHaveValue("Retry report");
    expect(screen.getByRole("heading", { name: "Number" })).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("loads an existing saved layout with an immutable name and stable widget id", () => {
    const initialLayout: FormsStatsDashboardLayout = {
      id: "weekly-sales",
      name: "Weekly sales",
      widgets: [{
        id: "weekly-orders",
        type: "line",
        title: "Weekly orders",
        query: { dimension: "submitted_at", timeUnit: "week", measure: "order_count", aggregation: "count", sort: "default" },
      }],
    };
    render(<FormsStatsBuilder initialLayout={initialLayout} canViewFinance onBack={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByLabelText("Report name")).toHaveValue("Weekly sales");
    expect(screen.getByLabelText("Report name")).toHaveAttribute("readonly");
    expect(screen.getByText("Saved report names cannot be changed. Create a new report to use a different name.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Report name"), { target: { value: "Renamed report" } });
    expect(screen.getByLabelText("Report name")).toHaveValue("Weekly sales");
    expect(screen.getByLabelText("Widget title")).toHaveValue("Weekly orders");
    fireEvent.change(screen.getByLabelText("Widget title"), { target: { value: "Orders by week" } });
    expect(screen.getByRole("heading", { name: "Orders by week" }).closest("article")).toHaveAttribute("data-widget-id", "weekly-orders");
    expect(randomUUID).not.toHaveBeenCalled();
  });
});
