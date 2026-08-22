import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FormsFilterBuilder } from "./forms-filter-builder";

describe("forms filter builder", () => {
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

  it("hides financial filters and can reset active filters", () => {
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
    expect(apply).toHaveBeenCalledWith({ match: "and", conditions: [] });
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
