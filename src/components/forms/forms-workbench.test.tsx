import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseFormWorkbenchQuery } from "@/server/forms/forms-workbench-service";
import { formOrderRow } from "./forms-test-data";
import { FormsWorkbench } from "./forms-workbench";

const { push, replace } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }));
vi.mock("./forms-job-drawer", () => ({
  FormsJobDrawer: ({ jobId, onClose }: { jobId: string; onClose: () => void }) => <div role="dialog" aria-label={`Drawer ${jobId}`}><button onClick={onClose}>Close drawer</button></div>,
}));
vi.mock("./forms-order-entry-drawer", () => ({
  FormsOrderEntryDrawer: ({ onClose }: { onClose: () => void }) => <div role="dialog" aria-label="Order entry"><button onClick={onClose}>Close order entry</button></div>,
}));

describe("FormsWorkbench", () => {
  beforeEach(() => {
    push.mockReset();
    replace.mockReset();
  });

  it("renders source-style list controls, table, mobile cards and footer", () => {
    render(<FormsWorkbench
      result={{ items: [formOrderRow], total: 1, page: 1, pageSize: 20, pageCount: 1 }}
      query={parseFormWorkbenchQuery({ q: "07188" })}
      canExport
      canViewFinance
    />);

    expect(screen.getByRole("searchbox", { name: "Search Ref No. / Cust.Name" })).toHaveValue("07188");
    expect(screen.getByRole("searchbox", { name: "Search Ref No. / Cust.Name" })).toHaveAttribute("placeholder", "Search name / order no.");
    expect(screen.getByRole("button", { name: "Search orders" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter orders" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href", expect.stringContaining("/api/forms/jobs/export"));
    expect(screen.getByRole("table", { name: "Orders data list" })).toBeInTheDocument();
    expect(screen.getByLabelText("Mobile orders data list")).toBeInTheDocument();
    expect(screen.getByText("1 order")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Column stats" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Orders per page" })).toHaveValue("20");

    fireEvent.click(screen.getAllByRole("button", { name: "Open order 07188" })[0]);
    expect(screen.getByRole("dialog", { name: "Drawer job-1" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Column stats" }));
    expect(screen.getByRole("region", { name: "Visible column statistics" })).toHaveTextContent("Urgent1");
    expect(screen.getByRole("region", { name: "Visible column statistics" })).toHaveTextContent("Amount payable");
  });

  it("provides a clear empty state", () => {
    render(<FormsWorkbench
      result={{ items: [], total: 0, page: 1, pageSize: 20, pageCount: 0 }}
      query={parseFormWorkbenchQuery({ q: "missing" })}
      canExport={false}
      canViewFinance={false}
    />);
    expect(screen.getByRole("heading", { name: "No orders match these filters." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/order-system");
  });

  it("closes manual entry without losing the Data list query or table", () => {
    render(<FormsWorkbench
      result={{ items: [formOrderRow], total: 40, page: 2, pageSize: 20, pageCount: 2 }}
      query={parseFormWorkbenchQuery({ q: "07188", page: "2" })}
      canExport
      canViewFinance
      orderEntry={{
        assignees: [],
        canManageFinance: true,
        canUploadFiles: true,
        submittedBy: "operator@example.test",
        productTitles: ["Canvas"],
        customFields: [],
        invoiceBusiness: { name: "R&R Gallery", address: "Auckland", email: "orders@example.test", phone: "+64", website: "https://example.test", gstNumber: "GST", bankAccount: "00" },
      }}
    />);

    expect(screen.getByRole("dialog", { name: "Order entry" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close order entry" }));
    expect(replace).toHaveBeenCalledWith("/order-system?q=07188&page=2");
    expect(screen.getByRole("table", { name: "Orders data list" })).toBeInTheDocument();
  });
});
