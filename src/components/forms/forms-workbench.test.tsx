import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  afterEach(() => vi.unstubAllGlobals());

  it("renders source-style list controls, table, mobile cards and footer", () => {
    render(<FormsWorkbench
      result={{ items: [formOrderRow], total: 1, page: 1, pageSize: 100, pageCount: 1 }}
      query={parseFormWorkbenchQuery({ q: "07188" })}
      canExport
      canViewFinance
    />);

    expect(screen.getByRole("searchbox", { name: "Search Ref No. / Cust.Name" })).toHaveValue("07188");
    expect(screen.getByRole("searchbox", { name: "Search Ref No. / Cust.Name" })).toHaveAttribute("placeholder", "Search name / order no.");
    expect(screen.getByRole("button", { name: "Search orders" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter orders" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Export CSV" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Order results" })).toContainElement(
      screen.getByRole("table", { name: "Orders data list" }),
    );
    expect(screen.getByRole("table", { name: "Orders data list" })).toBeInTheDocument();
    expect(screen.getByLabelText("Mobile orders data list")).toBeInTheDocument();
    expect(screen.getByText("1 order")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Column stats" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Orders per page" })).toHaveValue("100");

    fireEvent.click(screen.getAllByRole("button", { name: "Open order 07188" })[0]);
    expect(screen.getByRole("dialog", { name: "Drawer job-1" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Column stats" }));
    expect(screen.getByRole("region", { name: "Visible column statistics" })).toHaveTextContent("Urgent1");
    expect(screen.getByRole("region", { name: "Visible column statistics" })).toHaveTextContent("Amount payable");
  });

  it("keeps presets and personal saved searches inside the filter workspace", () => {
    render(<FormsWorkbench
      result={{ items: [formOrderRow], total: 1, page: 1, pageSize: 100, pageCount: 1 }}
      query={parseFormWorkbenchQuery({ preset: "lastSixMonths" })}
      canExport
      canViewFinance
      canManageViews
      filterPeople={[{ id: "staff-1", name: "Rosemary" }]}
      savedViews={[{ id: "view-1", name: "Waiting payment", queryString: "filter=paymentStatus%7Eequals%7Eawaiting_payment" }]}
    />);

    expect(screen.queryByLabelText("Saved order view")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filter orders" }));
    expect(screen.getByRole("heading", { name: "Saved searches" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All data" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Last 6 months" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Waiting payment" })).toBeInTheDocument();
    expect(screen.getByLabelText("Saved view name")).toBeInTheDocument();
  });

  it("saves the current filter draft without requiring a search first", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: "created" }), { status: 201 }));
    vi.stubGlobal("fetch", request);
    render(<FormsWorkbench
      result={{ items: [formOrderRow], total: 1, page: 1, pageSize: 100, pageCount: 1 }}
      query={parseFormWorkbenchQuery({})}
      canExport
      canViewFinance
      canManageViews
      filterPeople={[{ id: "staff-1", name: "Rosemary" }]}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Filter orders" }));
    fireEvent.change(screen.getByLabelText("Updated date from"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText("Updated date to"), { target: { value: "2026-08-23" } });
    fireEvent.change(screen.getByLabelText("Artist"), { target: { value: "staff-1" } });
    fireEvent.change(screen.getByLabelText("Saved view name"), { target: { value: "August artist" } });
    fireEvent.click(screen.getByRole("button", { name: "Save current view" }));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const payload = JSON.parse(String(request.mock.calls[0]?.[1]?.body)) as { name: string; queryString: string };
    expect(payload).toEqual({
      name: "August artist",
      queryString: "filter=updatedAt%7Ebetween%7E2026-08-01%252C2026-08-23&filter=assignedUserId%7Eequals%7Estaff-1",
    });
  });

  it("provides a clear empty state", () => {
    render(<FormsWorkbench
      result={{ items: [], total: 0, page: 1, pageSize: 100, pageCount: 0 }}
      query={parseFormWorkbenchQuery({ q: "missing" })}
      canExport={false}
      canViewFinance={false}
    />);
    expect(screen.getByRole("heading", { name: "No orders match these filters." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/order-system");
  });

  it("closes manual entry without losing the Data list query or table", () => {
    render(<FormsWorkbench
      result={{ items: [formOrderRow], total: 40, page: 2, pageSize: 100, pageCount: 1 }}
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
