import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FormStatWidget } from "@/server/forms/forms-stats-service";
import { FormsStatsWidgetEditor } from "./forms-stats-widget-editor";

const weeklyOrders: FormStatWidget = {
  id: "weekly-orders",
  type: "line",
  title: "Weekly orders",
  query: {
    dimension: "submitted_at",
    timeUnit: "week",
    measure: "order_count",
    aggregation: "count",
    sort: "default",
  },
};

describe("FormsStatsWidgetEditor", () => {
  it("shows date settings and emits valid dimension, measure, aggregation, sort, and chart patches", () => {
    const onChange = vi.fn();
    const { rerender } = render(<FormsStatsWidgetEditor widget={weeklyOrders} canViewFinance onChange={onChange} />);

    expect(screen.getByLabelText("Time unit")).toHaveValue("week");
    expect(screen.getByLabelText("Aggregation").querySelector('option[value="sum"]')).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Time unit"), { target: { value: "month" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      query: expect.objectContaining({ timeUnit: "month" }),
    }));

    fireEvent.change(screen.getByLabelText("Y axis"), { target: { value: "amount_payable" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      query: expect.objectContaining({ measure: "amount_payable", aggregation: "sum" }),
    }));

    const payableWidget: FormStatWidget = {
      ...weeklyOrders,
      query: { ...weeklyOrders.query!, measure: "amount_payable", aggregation: "sum", sort: "value_desc" },
    };
    rerender(<FormsStatsWidgetEditor widget={payableWidget} canViewFinance onChange={onChange} />);
    expect(screen.getByLabelText("Aggregation").querySelector('option[value="count"]')).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "label_asc" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      query: expect.objectContaining({ sort: "label_asc" }),
    }));
    fireEvent.change(screen.getByLabelText("Chart type"), { target: { value: "bar" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ type: "bar" }));
  });

  it("only offers a time unit for date dimensions and removes it for categories", () => {
    const onChange = vi.fn();
    const { rerender } = render(<FormsStatsWidgetEditor widget={weeklyOrders} canViewFinance onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("X axis"), { target: { value: "status" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      query: {
        dimension: "status",
        measure: "order_count",
        aggregation: "count",
        sort: "default",
      },
    }));

    rerender(<FormsStatsWidgetEditor widget={{
      ...weeklyOrders,
      query: { dimension: "status", measure: "order_count", aggregation: "count", sort: "default" },
    }} canViewFinance onChange={onChange} />);
    expect(screen.queryByLabelText("Time unit")).not.toBeInTheDocument();
  });

  it("does not expose finance dimensions or measures without view_finance", () => {
    render(<FormsStatsWidgetEditor widget={weeklyOrders} canViewFinance={false} onChange={vi.fn()} />);

    expect(screen.queryByRole("option", { name: "BankRecon" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "AmtPayable" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Order count" })).toBeInTheDocument();
  });

  it("keeps number widgets dimensionless and edits text content", () => {
    const onNumberChange = vi.fn();
    render(<FormsStatsWidgetEditor widget={{
      id: "total-orders", type: "number", title: "Orders", query: { measure: "order_count", aggregation: "count", sort: "default" },
    }} canViewFinance onChange={onNumberChange} />);
    expect(screen.queryByLabelText("X axis")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Time unit")).not.toBeInTheDocument();

    const onTextChange = vi.fn();
    const { rerender } = render(<FormsStatsWidgetEditor widget={{ id: "note", type: "text", title: "Note", text: "First" }} canViewFinance onChange={onTextChange} />);
    rerender(<FormsStatsWidgetEditor widget={{ id: "note", type: "text", title: "Note", text: "First" }} canViewFinance onChange={onTextChange} />);
    fireEvent.change(screen.getByLabelText("Text content"), { target: { value: "Updated note" } });
    expect(onTextChange).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Updated note" }));
  });

  it("preserves a legacy metric without offering incompatible query transitions", () => {
    render(<FormsStatsWidgetEditor widget={{
      id: "legacy-orders", type: "number", title: "Orders", metric: "job_count",
    }} canViewFinance onChange={vi.fn()} />);

    expect(screen.getByText("This saved control uses a compatible legacy statistic.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Chart type")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Y axis")).not.toBeInTheDocument();
  });
});
