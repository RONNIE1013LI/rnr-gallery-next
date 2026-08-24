import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FormStatistic } from "@/server/forms/drizzle-forms-stats-repository";
import type { FormStatWidget } from "@/server/forms/forms-stats-service";
import { FormsStatsChart, FormsStatsTooltip, formatStatisticAxisValue, formatStatisticValue } from "./forms-stats-chart";

class SizedResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    this.callback([{ contentRect: { width: 640, height: 260 }, target } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }

  unobserve() {}

  disconnect() {}
}

class MinWidthResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    const minimumWidth = Number.parseFloat((target as HTMLElement).style.minWidth) || 0;
    this.callback([{ contentRect: { width: Math.max(640, minimumWidth), height: 260 }, target } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }

  unobserve() {}

  disconnect() {}
}

const weeklyPayableWidget: FormStatWidget = {
  id: "weekly-payable",
  type: "bar",
  title: "Weekly payable",
  query: {
    dimension: "submitted_at",
    timeUnit: "week",
    measure: "amount_payable",
    aggregation: "sum",
    sort: "default",
  },
};

const weeklyPayableStat: FormStatistic = {
  query: weeklyPayableWidget.query!,
  rows: [{ label: "2026 W34", value: 697106 }, { label: "2026 W35", value: 310500 }],
};

async function renderSizedChart(widget: FormStatWidget, stat: FormStatistic) {
  const result = render(<FormsStatsChart widget={widget} stat={stat} />);
  await waitFor(() => expect(result.container.querySelector("svg")).toBeInTheDocument());
  return result;
}

describe("FormsStatsChart", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", SizedResizeObserver);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    ["bar", ".recharts-bar-rectangle"],
    ["line", ".recharts-line-curve"],
  ] as const)("renders sized %s chart output with NZD Y-axis labels", async (type, selector) => {
    const { container } = await renderSizedChart({ ...weeklyPayableWidget, type }, weeklyPayableStat);

    expect(container.querySelector(selector)).toBeInTheDocument();
    expect([...container.querySelectorAll("svg text")].map((node) => node.textContent).join(" ")).toContain("$");
    expect(screen.getByRole("table", { name: "Weekly payable data" })).toHaveTextContent("2026 W34");
    expect(screen.getByText("$6,971.06")).toBeInTheDocument();
  });

  it("formats monetary axis values from cents into NZD", () => {
    expect(formatStatisticValue(weeklyPayableWidget, 697106)).toBe("$6,971.06");
    expect(formatStatisticAxisValue(weeklyPayableWidget, 697106)).toBe("$6,971.06");
  });

  it("renders positive pie sectors", async () => {
    const { container } = await renderSizedChart({ ...weeklyPayableWidget, type: "pie" }, weeklyPayableStat);

    expect(container.querySelector(".recharts-pie-sector")).toBeInTheDocument();
  });

  it.each([
    ["all zero", [{ label: "Zero", value: 0 }]],
    ["all negative", [{ label: "Loss", value: -100 }]],
    ["mixed sign", [{ label: "Profit", value: 100 }, { label: "Loss", value: -50 }]],
  ] as const)("uses an accessible fallback for %s pie data", async (_case, rows) => {
    const { container } = render(<FormsStatsChart widget={{ ...weeklyPayableWidget, type: "pie" }} stat={{ query: weeklyPayableWidget.query!, rows }} />);

    expect(screen.getByRole("status")).toHaveTextContent("Pie charts require positive values. Use a bar or line chart instead.");
    expect(screen.getByRole("table", { name: "Weekly payable data" })).toHaveTextContent(rows[0].label);
    expect(container.querySelector(".recharts-pie-sector")).not.toBeInTheDocument();
  });

  it.each(["bar", "line", "pie"] as const)("gives the focusable %s chart root a distinct useful description", async (type) => {
    const { container } = await renderSizedChart({ ...weeklyPayableWidget, type }, weeklyPayableStat);
    const summary = document.getElementById("form-stat-chart-weekly-payable-summary")!;
    const focusable = screen.getByRole("application", { name: "Weekly payable chart" });

    expect(screen.queryByRole("img", { name: "Weekly payable chart" })).not.toBeInTheDocument();
    expect(summary.tagName).toBe("P");
    expect(summary).toHaveTextContent("2 data points. An equivalent data table follows.");
    expect(summary).not.toHaveTextContent("Weekly payable chart");
    expect(focusable).toBeInTheDocument();
    expect(focusable).toHaveAttribute("aria-label", "Weekly payable chart");
    expect(focusable).toHaveAttribute("aria-describedby", "form-stat-chart-weekly-payable-summary");
    expect(container.querySelectorAll('[aria-describedby="form-stat-chart-weekly-payable-summary"]')).toHaveLength(1);
    expect(focusable.querySelector("title")).not.toHaveTextContent("Weekly payable chart");
    expect(focusable?.closest('[role="img"]')).toBeNull();
    expect(container.querySelector('[role="status"]')).not.toBeInTheDocument();
  });

  it("uses keyboard navigation on the named chart to update the live tooltip", async () => {
    await renderSizedChart(weeklyPayableWidget, weeklyPayableStat);
    const chart = screen.getByRole("application", { name: "Weekly payable chart" });

    chart.focus();
    expect(document.activeElement).toBe(chart);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("2026 W34"));
    expect(screen.getByRole("status")).toHaveTextContent("$6,971.06");

    chart.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("2026 W35"));
    expect(screen.getByRole("status")).toHaveTextContent("$3,105.00");
  });

  it("gives a large monetary Y axis enough room for NZD tick text", async () => {
    const { container } = await renderSizedChart(weeklyPayableWidget, {
      query: weeklyPayableWidget.query!,
      rows: [{ label: "2026 W34", value: 10_000_000 }, { label: "2026 W35", value: 8_000_000 }],
    });
    expect(container.querySelector(".recharts-cartesian-grid-horizontal line")).toHaveAttribute("x1", "117");
    expect([...container.querySelectorAll("svg text")].map((node) => node.textContent).join(" ")).toContain("$100,000.00");

    const countWidget: FormStatWidget = { ...weeklyPayableWidget, query: { measure: "order_count", aggregation: "count", sort: "default" } };
    const countChart = await renderSizedChart(countWidget, { query: countWidget.query!, rows: weeklyPayableStat.rows! });
    expect(countChart.container.querySelector(".recharts-cartesian-grid-horizontal line")).toHaveAttribute("x1", "65");
  });

  it("grows wide bar and line charts within the chart scroller while hiding duplicate table visuals", async () => {
    const rows = Array.from({ length: 16 }, (_, index) => ({ label: `2026 W${index + 1}`, value: index + 1 }));
    const { container } = await renderSizedChart({ ...weeklyPayableWidget, type: "line" }, { query: weeklyPayableWidget.query!, rows });
    const summary = document.getElementById("form-stat-chart-weekly-payable-summary")!;
    const chart = summary.nextElementSibling as HTMLElement;
    const table = screen.getByRole("table", { name: "Weekly payable data" });

    expect(chart.style.minWidth).toBe("896px");
    expect(table.className).toContain("srOnly");
    expect(table).not.toHaveStyle({ display: "none" });
    expect(container.querySelector(".recharts-line-curve")).toBeInTheDocument();
  });

  it("renders every bar at 15 pixels wide", async () => {
    const { container } = await renderSizedChart(weeklyPayableWidget, weeklyPayableStat);
    await waitFor(
      () => expect(container.querySelectorAll(".recharts-bar-rectangle .recharts-rectangle")).toHaveLength(2),
      { timeout: 2_500 },
    );
    const bars = [...container.querySelectorAll(".recharts-bar-rectangle .recharts-rectangle")];

    expect(bars.map((bar) => bar.getAttribute("width"))).toEqual(["15", "15"]);
  });

  it("keeps 15 pixel bars close together in wide charts", async () => {
    vi.stubGlobal("ResizeObserver", MinWidthResizeObserver);
    const rows = Array.from({ length: 40 }, (_, index) => ({ label: `2026 W${index + 1}`, value: index + 1 }));

    const { container } = await renderSizedChart(weeklyPayableWidget, { query: weeklyPayableWidget.query!, rows });
    const summary = document.getElementById("form-stat-chart-weekly-payable-summary")!;
    await waitFor(
      () => expect(container.querySelectorAll(".recharts-bar-rectangle .recharts-rectangle")).toHaveLength(40),
      { timeout: 2_500 },
    );
    const bars = [...container.querySelectorAll(".recharts-bar-rectangle .recharts-rectangle")];
    const firstX = Number(bars[0]!.getAttribute("x"));
    const secondX = Number(bars[1]!.getAttribute("x"));
    const barWidth = Number(bars[0]!.getAttribute("width"));

    expect((summary.nextElementSibling as HTMLElement).style.minWidth).toBe("922px");
    expect(barWidth).toBe(15);
    expect(secondX - firstX - barWidth).toBeCloseTo(5, 5);
  });

  it("preserves 15 pixel bars and five pixel gaps for a full daily year", async () => {
    vi.stubGlobal("ResizeObserver", MinWidthResizeObserver);
    const rows = Array.from({ length: 366 }, (_, index) => ({ label: `Day ${index + 1}`, value: index + 1 }));

    const { container } = await renderSizedChart(weeklyPayableWidget, { query: weeklyPayableWidget.query!, rows });
    const summary = document.getElementById("form-stat-chart-weekly-payable-summary")!;
    await waitFor(
      () => expect(container.querySelectorAll(".recharts-bar-rectangle .recharts-rectangle")).toHaveLength(366),
      { timeout: 2_500 },
    );
    const bars = [...container.querySelectorAll(".recharts-bar-rectangle .recharts-rectangle")];
    const firstX = Number(bars[0]!.getAttribute("x"));
    const secondX = Number(bars[1]!.getAttribute("x"));
    const barWidth = Number(bars[0]!.getAttribute("width"));

    expect((summary.nextElementSibling as HTMLElement).style.minWidth).toBe("7442px");
    expect(barWidth).toBe(15);
    expect(secondX - firstX - barWidth).toBeCloseTo(5, 5);
  });

  it("uses a thin dashed center line instead of a shaded bar hover cursor", async () => {
    const { container } = await renderSizedChart(weeklyPayableWidget, weeklyPayableStat);

    const firstBar = await waitFor(() => {
      const bar = container.querySelector(".recharts-bar-rectangle .recharts-rectangle");
      expect(bar).toBeInTheDocument();
      return bar!;
    }, { timeout: 2_500 });
    fireEvent.mouseMove(firstBar, { clientX: 180, clientY: 100 });
    const cursor = await waitFor(() => {
      const line = container.querySelector("line.recharts-tooltip-cursor");
      expect(line).toBeInTheDocument();
      return line!;
    });

    expect(screen.getByRole("status")).toHaveTextContent("2026 W34");
    expect(cursor).toHaveAttribute("stroke-dasharray", "3 3");
    expect(cursor).toHaveAttribute("stroke-width", "1");
    expect(cursor.getAttribute("x1")).toBe(cursor.getAttribute("x2"));
    expect(Number(cursor.getAttribute("x1"))).toBeCloseTo(
      Number(firstBar.getAttribute("x")) + Number(firstBar.getAttribute("width")) / 2,
      5,
    );
    expect(container.querySelector("path.recharts-tooltip-cursor")).not.toBeInTheDocument();
  });

  it.each(["bar", "line"] as const)("opens wide %s charts at the newest data", async (type) => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(1_200);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
    const rows = Array.from({ length: 16 }, (_, index) => ({ label: `2026 W${index + 1}`, value: index + 1 }));

    await renderSizedChart({ ...weeklyPayableWidget, type }, { query: weeklyPayableWidget.query!, rows });
    const summary = document.getElementById("form-stat-chart-weekly-payable-summary")!;
    const scroller = summary.parentElement as HTMLElement;

    expect(scroller.scrollLeft).toBe(560);
  });

  it("keeps the full width of every point inside the horizontal scroller", async () => {
    const rows = Array.from({ length: 366 }, (_, index) => ({ label: `2026-01-${index + 1}`, value: index + 1 }));
    await renderSizedChart({ ...weeklyPayableWidget, type: "line" }, { query: weeklyPayableWidget.query!, rows });
    const summary = document.getElementById("form-stat-chart-weekly-payable-summary")!;

    expect((summary.nextElementSibling as HTMLElement).style.minWidth).toBe("20496px");
  });

  it("renders the exact active tooltip label, measure, aggregation, and formatted value", () => {
    render(<FormsStatsTooltip
      active
      label="2026 W34"
      payload={[{ name: "value", value: 697106, payload: { label: "2026 W34", value: 697106 } }]}
      widget={weeklyPayableWidget}
    />);

    expect(screen.getByText("2026 W34")).toBeInTheDocument();
    expect(screen.getByText("AmtPayable (Sum)")).toBeInTheDocument();
    expect(screen.getByText("$6,971.06")).toBeInTheDocument();
    expect(screen.getByRole("status").closest('[role="img"]')).toBeNull();
  });
});
