import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FormsOrderTable } from "./forms-order-table";
import { formOrderRow } from "./forms-test-data";

describe("FormsOrderTable", () => {
  it("renders the exact source column order and formatted values", () => {
    render(<FormsOrderTable rows={[formOrderRow]} canViewFinance onOpen={vi.fn()} />);
    const table = screen.getByRole("table", { name: "Orders data list" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "#", "Submitted Time", "Ref No.", "Web Order No.", "Size", "Urgent?",
      "DlvryDate", "DlvryMethod", "Customer Source", "Cust.Name",
      "Assign Artist", "Artist", "File Sent", "Download", "Customer Notified",
      "Printed", "Completed", "Delivered", "BankRecon", "AmtOwe", "AmtPaid",
      "AmtPayable", "Artist's Fee", "Remark", "Submitted By",
    ]);
    expect(screen.getByText("$130.00")).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "1" })).toBeInTheDocument();
    expect(screen.getByText("Urgent")).toBeInTheDocument();
    expect(screen.getAllByText("YES").length).toBeGreaterThan(0);
  });

  it("continues source row numbering across result pages", () => {
    render(<FormsOrderTable rows={[formOrderRow]} startIndex={100} canViewFinance onOpen={vi.fn()} />);
    expect(screen.getByRole("cell", { name: "101" })).toBeInTheDocument();
  });

  it("omits finance columns and opens the selected reference", () => {
    const onOpen = vi.fn();
    render(<FormsOrderTable rows={[{ ...formOrderRow, finance: null, bankRecon: null }]} canViewFinance={false} onOpen={onOpen} />);
    expect(screen.queryByRole("columnheader", { name: "AmtPayable" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open order 07188" }));
    expect(onOpen).toHaveBeenCalledWith("job-1");
  });

  it("exposes only capability-backed inline editors", () => {
    render(<FormsOrderTable
      rows={[formOrderRow]}
      canViewFinance
      canUpdate
      canUpdateFinance={false}
      canUpdateProductionStatus
      canUpdateDeliveryStatus={false}
      assignees={[{ id: "artist-1", name: "Rosemary" }]}
      onOpen={vi.fn()}
      onSaved={vi.fn()}
    />);
    expect(screen.getByRole("button", { name: "Edit DlvryDate for 07188" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Printed for 07188" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Delivered for 07188" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit AmtPaid for 07188" })).not.toBeInTheDocument();
  });

  it("keeps linked web-order totals visibly read-only", () => {
    render(<FormsOrderTable
      rows={[{ ...formOrderRow, source: "web" }]}
      canViewFinance canUpdate canUpdateFinance
      onOpen={vi.fn()} onSaved={vi.fn()}
    />);
    expect(screen.getByText("$230.00")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit AmtPayable for 07188" })).not.toBeInTheDocument();
  });

  it("exposes field-aware status metadata so identical labels keep their source colours", () => {
    const { container } = render(<FormsOrderTable rows={[{
      ...formOrderRow,
      deliveryMethod: "email",
      customerSource: "email",
      bankRecon: "Not checked",
    }]} canViewFinance onOpen={vi.fn()} />);

    expect(container.querySelector('[data-field="deliveryMethod"][data-status="email"]')).toHaveTextContent("Email");
    expect(container.querySelector('[data-field="customerSource"][data-status="email"]')).toHaveTextContent("Email");
    expect(container.querySelector('[data-field="bankRecon"][data-status="not-checked"]')).toHaveTextContent("Not checked");
  });

  it("shows and edits the manual Delivered HOLD state", () => {
    render(<FormsOrderTable
      rows={[{ ...formOrderRow, source: "manual", status: "on_hold", milestones: { ...formOrderRow.milestones, delivered: false } }]}
      canViewFinance canUpdate canUpdateDeliveryStatus
      onOpen={vi.fn()} onSaved={vi.fn()}
    />);

    expect(screen.getByText("HOLD")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit Delivered for 07188" }));
    expect(within(screen.getByLabelText("Delivered for 07188")).getAllByRole("option").map((option) => option.textContent))
      .toEqual(["NO", "YES", "HOLD"]);
  });
});
