import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { FormStatistic } from "@/server/forms/drizzle-forms-stats-repository";
import type { FormStatWidget } from "@/server/forms/forms-stats-service";
import { FormsStatsChart, FormsStatsTooltip } from "./forms-stats-chart";

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
  rows: [{ label: "2026 W34", value: 697106 }],
};

describe("FormsStatsChart", () => {
  it.each(["bar", "line", "pie"] as const)("renders an accessible %s chart and equivalent data table", (type) => {
    render(<FormsStatsChart widget={{ ...weeklyPayableWidget, type }} stat={weeklyPayableStat} />);

    expect(screen.getByRole("img", { name: "Weekly payable chart" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Weekly payable data" })).toHaveTextContent("2026 W34");
    expect(screen.getByText("$6,971.06")).toBeInTheDocument();
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
  });
});
