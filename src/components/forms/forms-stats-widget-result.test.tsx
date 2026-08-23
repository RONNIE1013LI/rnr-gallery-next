import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { FormStatistic } from "@/server/forms/drizzle-forms-stats-repository";
import type { FormStatWidget } from "@/server/forms/forms-stats-service";
import { FormsStatsWidgetResult } from "./forms-stats-widget-result";

const orderCountQuery = { measure: "order_count", aggregation: "count", sort: "default" } as const;
const payableQuery = { measure: "amount_payable", aggregation: "sum", sort: "default" } as const;

const numberWidget: FormStatWidget = { id: "orders", type: "number", title: "Orders", query: orderCountQuery };
const tableWidget: FormStatWidget = { id: "methods", type: "table", title: "Delivery methods", query: { ...orderCountQuery, dimension: "delivery_method" } };
const payableStat: FormStatistic = { query: payableQuery, value: 697106 };
const deliveryStat: FormStatistic = { query: tableWidget.query!, rows: [{ label: "Post", value: 12 }] };

describe("FormsStatsWidgetResult", () => {
  it("formats numbers and tables using NZD and integer conventions", () => {
    const { rerender } = render(<FormsStatsWidgetResult widget={{ ...numberWidget, query: payableQuery }} stat={payableStat} />);
    expect(screen.getByText("$6,971.06")).toBeInTheDocument();

    rerender(<FormsStatsWidgetResult widget={tableWidget} stat={deliveryStat} />);
    expect(screen.getByRole("table", { name: "Delivery methods data" })).toHaveTextContent("Post");
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("renders text and divider widgets without a statistic", () => {
    const { rerender } = render(<FormsStatsWidgetResult widget={{ id: "note", type: "text", title: "Note", text: "Review Monday." }} />);
    expect(screen.getByText("Review Monday.")).toBeInTheDocument();

    rerender(<FormsStatsWidgetResult widget={{ id: "break", type: "divider", title: "Break" }} />);
    expect(screen.getByRole("separator", { name: "Break" })).toBeInTheDocument();
  });

  it.each([
    ["loading", "Loading statistic…"],
    ["empty", "No statistics are available."],
    ["error", "Statistic unavailable."],
  ] as const)("renders the %s state", (state, message) => {
    render(<FormsStatsWidgetResult widget={numberWidget} state={state} />);
    expect(screen.getByText(message)).toBeInTheDocument();
  });
});
