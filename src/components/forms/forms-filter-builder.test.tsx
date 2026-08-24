import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FormsFilterBuilder } from "./forms-filter-builder";

describe("forms filter builder", () => {
  it("shows common updated-date and artist controls while keeping advanced conditions separate", () => {
    const apply = vi.fn();
    render(<FormsFilterBuilder
      conditions={[
        { field: "updatedAt", operator: "between", value: ["2026-08-01", "2026-08-23"] },
        { field: "assignedUserId", operator: "equals", value: "staff-1" },
        { field: "urgent", operator: "equals", value: "true" },
      ]}
      match="and"
      canViewFinance
      people={[{ id: "staff-1", name: "Rosemary" }]}
      onApply={apply}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Filter orders (3 active)" }));

    expect(screen.getByRole("heading", { name: "Common conditions" })).toBeInTheDocument();
    expect(screen.getByLabelText("Updated date from")).toHaveValue("2026-08-01");
    expect(screen.getByLabelText("Updated date to")).toHaveValue("2026-08-23");
    expect(screen.getByLabelText("Artist")).toHaveValue("staff-1");
    expect(screen.getByLabelText("Filter field 1")).toHaveValue("urgent");

    fireEvent.change(screen.getByLabelText("Updated date from"), { target: { value: "2026-08-02" } });
    fireEvent.change(screen.getByLabelText("Updated date to"), { target: { value: "2026-08-22" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    expect(apply).toHaveBeenCalledWith({
      match: "and",
      conditions: [
        { field: "updatedAt", operator: "between", value: ["2026-08-02", "2026-08-22"] },
        { field: "assignedUserId", operator: "equals", value: "staff-1" },
        { field: "urgent", operator: "equals", value: "true" },
      ],
    });
  });

  it("starts with a choose-field row instead of silently applying urgency", () => {
    const apply = vi.fn();
    render(<FormsFilterBuilder conditions={[]} match="and" canViewFinance onApply={apply} />);

    fireEvent.click(screen.getByRole("button", { name: "Filter orders" }));
    expect(screen.getByLabelText("Filter field 1")).toHaveValue("");
    expect(screen.getByRole("option", { name: "Choose field" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(apply).toHaveBeenCalledWith({ match: "and", conditions: [] });
  });

  it("keeps each remove control inside its own condition row", () => {
    render(<FormsFilterBuilder
      conditions={[
        { field: "urgent", operator: "equals", value: "true" },
        { field: "status", operator: "equals", value: "new" },
      ]}
      match="and"
      canViewFinance
      onApply={vi.fn()}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Filter orders (2 active)" }));

    expect(screen.getByRole("button", { name: "Remove condition 1" }).closest('[data-filter-row="true"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Remove condition 2" }).closest('[data-filter-row="true"]')).not.toBeNull();
  });

  it("fails closed for incomplete or reversed updated-date ranges", () => {
    render(<FormsFilterBuilder conditions={[]} match="and" canViewFinance onApply={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Filter orders" }));
    fireEvent.change(screen.getByLabelText("Updated date from"), { target: { value: "2026-08-23" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Choose both dates in chronological order.");
    expect(screen.getByRole("button", { name: "Apply filters" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Updated date to"), { target: { value: "2026-08-01" } });
    expect(screen.getByRole("button", { name: "Apply filters" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Updated date to"), { target: { value: "2026-08-23" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply filters" })).toBeEnabled();
  });

  it("keeps common and advanced conditions within the shared 20-filter limit", () => {
    render(<FormsFilterBuilder
      conditions={[
        { field: "updatedAt", operator: "between", value: ["2026-08-01", "2026-08-23"] },
        ...Array.from({ length: 19 }, () => ({ field: "urgent", operator: "equals", value: "true" } as const)),
      ]}
      match="and"
      canViewFinance
      people={[{ id: "staff-1", name: "Rosemary" }]}
      onApply={vi.fn()}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Filter orders (20 active)" }));
    expect(screen.getByRole("button", { name: "+ Add condition" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Artist"), { target: { value: "staff-1" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Use no more than 20 total conditions.");
    expect(screen.getByRole("button", { name: "Apply filters" })).toBeDisabled();
  });

  it("resets the open draft and active preset without applying or closing", () => {
    const apply = vi.fn();
    const changePreset = vi.fn();
    render(<FormsFilterBuilder
      conditions={[
        { field: "updatedAt", operator: "between", value: ["2026-08-01", "2026-08-23"] },
        { field: "urgent", operator: "equals", value: "true" },
      ]}
      match="or"
      canViewFinance
      preset="lastYear"
      onPresetChange={changePreset}
      onApply={apply}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Filter orders (2 active)" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));

    expect(screen.getByRole("dialog", { name: "Order filters" })).toBeInTheDocument();
    expect(screen.getByLabelText("Match")).toHaveValue("and");
    expect(screen.getByLabelText("Updated date from")).toHaveValue("");
    expect(screen.getByLabelText("Updated date to")).toHaveValue("");
    expect(screen.getByLabelText("Filter field 1")).toHaveValue("");
    expect(changePreset).toHaveBeenCalledWith("all");
    expect(apply).not.toHaveBeenCalled();
  });

  it("opens accessibly, applies a validated filter and restores focus on Escape", () => {
    const apply = vi.fn();
    render(<FormsFilterBuilder conditions={[]} match="and" canViewFinance onApply={apply} />);

    const trigger = screen.getByRole("button", { name: "Filter orders" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Order filters" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter field 1"), { target: { value: "urgent" } });
    fireEvent.change(screen.getByLabelText("Filter value 1"), { target: { value: "true" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(apply).toHaveBeenCalledWith({
      match: "and",
      conditions: [{ field: "urgent", operator: "equals", value: "true" }],
    });

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Order filters" }), { key: "Escape" });
    expect(trigger).toHaveFocus();
  });

  it("closes after Search applies the current filters", () => {
    const apply = vi.fn();
    render(<FormsFilterBuilder conditions={[]} match="and" canViewFinance onApply={apply} />);

    fireEvent.click(screen.getByRole("button", { name: "Filter orders" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    expect(apply).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Order filters" })).not.toBeInTheDocument();
  });

  it("closes after choosing a saved date preset", () => {
    render(<FormsFilterBuilder
      conditions={[]}
      match="and"
      canViewFinance
      onPresetChange={vi.fn()}
      onApply={vi.fn()}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Filter orders" }));
    fireEvent.click(screen.getByRole("button", { name: "Last 6 months" }));

    expect(screen.queryByRole("dialog", { name: "Order filters" })).not.toBeInTheDocument();
  });

  it("stays open for panel clicks and closes for a click anywhere outside the panel", async () => {
    render(<div>
      <button type="button">Outside action</button>
      <FormsFilterBuilder conditions={[]} match="and" canViewFinance onApply={vi.fn()} />
    </div>);

    const outsideAction = screen.getByRole("button", { name: "Outside action" });
    const trigger = screen.getByRole("button", { name: "Filter orders" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Order filters" });

    fireEvent.click(screen.getByLabelText("Match"));
    expect(dialog).toBeInTheDocument();

    fireEvent.click(outsideAction);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Order filters" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("lets a saved search close the funnel before opening its query", () => {
    render(<FormsFilterBuilder
      conditions={[]}
      match="and"
      canViewFinance
      renderSavedSearches={(_group, close) => (
        <button type="button" onClick={() => close?.()}>Saved post orders</button>
      )}
      onApply={vi.fn()}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Filter orders" }));
    fireEvent.click(screen.getByRole("button", { name: "Saved post orders" }));

    expect(screen.queryByRole("dialog", { name: "Order filters" })).not.toBeInTheDocument();
  });

  it("hides financial filters and can reset the active draft", () => {
    const apply = vi.fn();
    render(<FormsFilterBuilder
      conditions={[{ field: "status", operator: "equals", value: "new" }]}
      match="or"
      canViewFinance={false}
      onApply={apply}
    />);
    expect(screen.getByRole("button", { name: "Filter orders (1 active)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filter orders (1 active)" }));
    expect(screen.queryByRole("option", { name: "Bank reconciliation" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(screen.getByRole("dialog", { name: "Order filters" })).toBeInTheDocument();
    expect(screen.getByLabelText("Filter field 1")).toHaveValue("");
    expect(apply).not.toHaveBeenCalled();
  });

  it("offers manual-entry fields, submitting operators, and configured fields with permission gating", () => {
    const apply = vi.fn();
    render(<FormsFilterBuilder
      conditions={[]}
      match="and"
      canViewFinance
      canViewCustomerContact
      canViewPaymentProof
      people={[{ id: "staff-1", name: "Rosemary" }]}
      customFields={[{
        id: "00000000-0000-4000-8000-000000000091",
        label: "Campaign note",
        fieldType: "text",
        options: [],
        section: "order",
      }]}
      onApply={apply}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Filter orders" }));
    const field = screen.getByLabelText("Filter field 1");
    expect(field).toHaveTextContent("Submitted by");
    expect(field).toHaveTextContent("Customer name");
    expect(field).toHaveTextContent("Amount owing");
    expect(field).toHaveTextContent("Payment proof");
    expect(field).toHaveTextContent("Campaign note");

    fireEvent.change(field, { target: { value: "submittedByUserId" } });
    expect(screen.getByLabelText("Filter value 1")).toHaveTextContent("Rosemary");
  });

  it("keeps value-free is-not-empty conditions when applying filters", () => {
    const apply = vi.fn();
    render(<FormsFilterBuilder conditions={[]} match="and" canViewFinance onApply={apply} />);

    fireEvent.click(screen.getByRole("button", { name: "Filter orders" }));
    fireEvent.change(screen.getByLabelText("Filter field 1"), { target: { value: "reference" } });
    fireEvent.change(screen.getByLabelText("Filter operator 1"), { target: { value: "isNotEmpty" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    expect(apply).toHaveBeenCalledWith({
      match: "and",
      conditions: [{ field: "reference", operator: "isNotEmpty", value: "" }],
    });
  });

  it("traps focus, isolates the background and closes from the document or backdrop", async () => {
    const apply = vi.fn();
    render(<div>
      <button type="button">Background action</button>
      <FormsFilterBuilder conditions={[]} match="and" canViewFinance onApply={apply} />
    </div>);

    const trigger = screen.getByRole("button", { name: "Filter orders" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Order filters" });
    const match = screen.getByLabelText("Match");
    await waitFor(() => expect(match).toHaveFocus());
    const backgroundAction = screen.getByText("Background action").closest("button");
    expect(backgroundAction).toHaveProperty("inert", true);
    expect(document.body.style.overflow).toBe("hidden");

    const focusable = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("");

    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByTestId("filter-backdrop"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
