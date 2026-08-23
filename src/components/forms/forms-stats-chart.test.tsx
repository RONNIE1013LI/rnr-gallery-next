import { render, screen, waitFor } from "@testing-library/react";
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

  it("keeps Recharts focus and live-tooltip descendants outside an image role", async () => {
    const { container } = await renderSizedChart(weeklyPayableWidget, weeklyPayableStat);
    const summary = screen.getByText("Weekly payable chart");
    const focusable = container.querySelector('[tabindex="0"]');

    expect(screen.queryByRole("img", { name: "Weekly payable chart" })).not.toBeInTheDocument();
    expect(summary.tagName).toBe("P");
    expect(focusable).toBeInTheDocument();
    expect(focusable?.closest('[role="img"]')).toBeNull();
    expect(container.querySelector('[role="status"]')).not.toBeInTheDocument();
  });

  it("grows wide bar and line charts within the chart scroller while hiding duplicate table visuals", async () => {
    const rows = Array.from({ length: 16 }, (_, index) => ({ label: `2026 W${index + 1}`, value: index + 1 }));
    const { container } = await renderSizedChart({ ...weeklyPayableWidget, type: "line" }, { query: weeklyPayableWidget.query!, rows });
    const summary = screen.getByText("Weekly payable chart");
    const chart = summary.nextElementSibling as HTMLElement;
    const table = screen.getByRole("table", { name: "Weekly payable data" });

    expect(chart.style.minWidth).toBe("1152px");
    expect(table.className).toContain("srOnly");
    expect(table).not.toHaveStyle({ display: "none" });
    expect(container.querySelector(".recharts-line-curve")).toBeInTheDocument();
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
