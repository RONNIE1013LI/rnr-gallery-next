import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductionJobControls } from "./production-job-controls";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const base = {
  jobId: "63f77c27-fd7b-4c65-a834-886c128b6cc1",
  source: "manual" as const,
  orderId: null,
  expectedUpdatedAt: "2026-08-04T03:00:00.000Z",
  status: "new",
  paymentStatus: "awaiting_payment",
  assignedUserId: null,
  urgent: false,
  neededDate: "2026-08-11",
  deliveryMethod: "post" as const,
  deliveryAddress: "11 Example Street",
  paymentReconciliationStatus: "Not checked",
  designRequirements: "Orange background",
  internalNotes: "Confirm wording",
  milestones: { fileSent: false, downloaded: false, printed: false, customerNotified: false, delivered: false, artistPaid: false, completed: false },
  finance: { amountPayableCents: 23000, amountPaidCents: 10000, artistFeeCents: 4000, materialCostCents: 2500 },
  customFields: [],
};

describe("ProductionJobControls", () => {
  it("updates the manual production plan with optimistic locking", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: "updated" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "production-update-0001" });

    render(<ProductionJobControls {...base} assignees={[{ id: "staff-1", name: "Artist", email: "artist@example.test" }]} canManageFinance />);
    fireEvent.change(screen.getByLabelText("Assign to"), { target: { value: "staff-1" } });
    fireEvent.change(screen.getByLabelText("Production status"), { target: { value: "designing" } });
    fireEvent.click(screen.getByRole("button", { name: "Save production plan" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload).toMatchObject({
      expectedUpdatedAt: "2026-08-04T03:00:00.000Z",
      assignedUserId: "staff-1",
      manualStatus: "designing",
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps linked web status and finance under the original order workflow", () => {
    render(<ProductionJobControls {...base} source="web" orderId="order-1" finance={null} assignees={[]} canManageFinance />);
    expect(screen.getByRole("link", { name: "Update linked order" })).toHaveAttribute("href", "/admin/orders/order-1");
    expect(screen.queryByLabelText("Production status")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Finance" })).not.toBeInTheDocument();
  });

  it("can target the forms portal adapters without changing admin defaults", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: "updated" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "forms-update-0001" });
    render(<ProductionJobControls {...base} assignees={[]} canManageFinance={false} jobApiBase="/api/forms/jobs" orderBasePath="/forms/orders" />);
    fireEvent.click(screen.getByRole("button", { name: "Save production plan" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/forms/jobs/${base.jobId}`,
      expect.objectContaining({ method: "PATCH" }),
    ));
  });

  it("can hide the linked admin-order action inside the forms-only portal", () => {
    render(<ProductionJobControls {...base} source="web" orderId="order-1" finance={null} assignees={[]} canManageFinance={false} orderBasePath={null} />);
    expect(screen.getByText("Linked online order")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Update linked order" })).not.toBeInTheDocument();
  });
});
