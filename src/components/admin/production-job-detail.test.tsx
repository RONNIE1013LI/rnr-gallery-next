import { render, screen } from "@testing-library/react";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { normalizeAddress } from "@/domain/address/schema";
import { repriceCart } from "@/domain/checkout/reprice-cart";
import { buildWebProductionJobSnapshot } from "@/server/orders/drizzle-order-repository";

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

  it("shows both labelled Bundle component wording and instructions from a web order", () => {
    const now = new Date("2026-08-16T01:00:00.000Z");
    const cart = repriceCart({
      version: 1,
      items: [{
        clientItemId: randomUUID(),
        productKey: "banner-bundle",
        sizeKey: "rollup-wall-200x100",
        peoplePets: 0,
        photoSubmissionMethod: "later",
        designText: "",
        notes: "",
        neededDate: "2026-08-21",
        urgentServiceConfirmed: false,
        quantity: 1,
        uploadReferences: [],
        bundleComponents: [
          {
            componentKey: "roll-up",
            photoSubmissionMethod: "later",
            designText: "ROLL-UP WORDING",
            notes: "Keep the roll-up logo clear",
            uploadReferences: [],
          },
          {
            componentKey: "wall-banner",
            photoSubmissionMethod: "later",
            designText: "WALL BANNER WORDING",
            notes: "Use the wide wall layout",
            uploadReferences: [],
          },
        ],
      }],
    }, { now });
    const address = normalizeAddress({
      country: "NZ",
      fullName: "Customer",
      building: "",
      street: "1 Queen Street",
      suburb: "Auckland Central",
      region: "Auckland",
      postcode: "1010",
      phone: "021 000 0000",
      email: "customer@example.test",
    });
    const snapshot = buildWebProductionJobSnapshot({
      order: { id: randomUUID(), orderNumber: "08001" },
      cart,
      billingAddress: address,
      deliveryAddress: address,
      deliveryMethod: "post",
      orderItemIds: [randomUUID()],
      now,
    });
    const detail = {
      job: {
        ...snapshot.job,
        id: "job-bundle",
        webOrderNumber: "08001",
        paymentReconciliationStatus: "Not checked",
        assignedUserId: null,
        fileSentAt: null,
        downloadedAt: null,
        printedAt: null,
        customerNotifiedAt: null,
        deliveredAt: null,
        artistPaidAt: null,
        completedAt: null,
      },
      status: "new",
      paymentStatus: "awaiting_payment",
      orderNumber: "08001",
      assignee: null,
      items: snapshot.items.map((item, index) => ({
        ...item,
        id: `production-item-${index}`,
        jobId: "job-bundle",
      })),
      finance: null,
      customFields: [],
      audit: [],
    };

    render(<ProductionJobDetail
      detail={detail as never}
      assignees={[]}
      canManageFinance={false}
      canUpdateJob={false}
    />);

    expect(screen.getAllByText(/Roll-Up Banner — wording/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Wall Banner — wording/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Keep the roll-up logo clear/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Use the wide wall layout/).length).toBeGreaterThan(0);
  });
});
