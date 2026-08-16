import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProductionJobDetail } from "./production-job-detail";

vi.mock("./production-files-panel", () => ({ ProductionFilesPanel: () => null }));
vi.mock("./invoice-panel", () => ({ InvoicePanel: () => null }));

describe("ProductionJobDetail", () => {
  it("shows online order fields in the approved data-entry sequence", () => {
    const now = new Date("2026-08-16T01:00:00.000Z");
    const detail = {
      job: {
        id: "job-1", jobNumber: "08000", source: "web", orderId: "order-1",
        customerName: "Customer", customerEmail: "customer@example.test", customerPhone: "+64210000000",
        customerSource: "website", deliveryMethod: "post", deliveryAddress: "Auckland",
        webOrderNumber: "08000", urgent: false, neededDate: "2026-08-21",
        paymentReconciliationStatus: "Stripe", designRequirements: "Use blue", internalNotes: "Studio note",
        assignedUserId: null, createdAt: now, updatedAt: now,
        fileSentAt: null, downloadedAt: null, printedAt: null, customerNotifiedAt: null,
        deliveredAt: null, artistPaidAt: null, completedAt: null,
      },
      status: "new", paymentStatus: "paid", orderNumber: "08000", assignee: null,
      items: [{ id: "item-1", productTitle: "Canvas", sizeLabel: "A2", quantity: 1, designText: "Artwork", notes: "Notes" }],
      finance: {
        amountPayableCents: 26450, amountPaidCents: 26450, amountOwingCents: 0,
        artistFeeCents: 5000, materialCostCents: 3000, actualProfitCents: 18450,
      },
      customFields: [], audit: [],
    };

    render(<ProductionJobDetail
      detail={detail as never}
      assignees={[]}
      canManageFinance
      canUpdateJob={false}
    />);

    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "Order info",
      "Product / Size",
      "Payment",
      "Design & Notes",
      "Internal notes",
      "Delivery",
      "Customer info",
      "Internal Production Status",
      "Cost / Profit",
      "Activity",
    ]);
  });
});
