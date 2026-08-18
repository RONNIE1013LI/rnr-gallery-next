import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ProductionJobDetailPage from "./page";

const { requireAdminPage, detail, assignees } = vi.hoisted(() => ({
  requireAdminPage: vi.fn(), detail: vi.fn(), assignees: vi.fn(),
}));
vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/admin/admin-production-runtime", () => ({
  getAdminProductionRuntime: () => ({ detail, assignees }),
}));
vi.mock("@/server/admin/admin-production-proof-runtime", () => ({
  getAdminProductionProofRuntime: () => ({
    listFiles: vi.fn().mockResolvedValue({
      files: [],
      revision: { changesRequested: 0, freeRevisionsRemaining: 2, requiresAdditionalChargeReview: false },
    }),
  }),
}));
vi.mock("@/server/notifications/customer-notification-runtime", () => ({
  getCustomerNotificationRuntime: () => ({ listForJob: vi.fn().mockResolvedValue([]) }),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => { throw new Error("not found"); }),
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("production job detail page", () => {
  it("shows linked order authority, work details, milestones and admin finance", async () => {
    requireAdminPage.mockResolvedValue({ user: { id: "admin-1" }, adminRole: "admin", adminPermissions: [] });
    assignees.mockResolvedValue([]);
    detail.mockResolvedValue({
      job: {
        id: "63f77c27-fd7b-4c65-a834-886c128b6cc1", jobNumber: "RNR-2026-ABC123", source: "web",
        orderId: "73f77c27-fd7b-4c65-a834-886c128b6cc2", customerName: "Example Customer",
        customerEmail: "customer@example.test", customerPhone: "0210000000", customerSource: "web",
        urgent: true, neededDate: "2026-08-11", deliveryMethod: "post", assignedUserId: null,
        designRequirements: "Use the main photo", internalNotes: "", fileSentAt: new Date("2026-08-04T04:00:00Z"),
        downloadedAt: null, printedAt: null, customerNotifiedAt: null, deliveredAt: null,
        createdAt: new Date("2026-08-04T02:00:00Z"), updatedAt: new Date("2026-08-04T03:00:00Z"),
      },
      orderNumber: "RNR-2026-ABC123", status: "designing", paymentStatus: "paid", assignee: null,
      items: [{ id: "item-1", productTitle: "Digital Oil Painting Canvas", sizeLabel: "A0", quantity: 1, designText: "Family portrait", notes: "Warm background" }],
      finance: { amountPayableCents: 34500, amountPaidCents: 34500, amountOwingCents: 0, artistFeeCents: null, materialCostCents: null, actualProfitCents: null },
      audit: [],
    });
    render(await ProductionJobDetailPage({ params: Promise.resolve({ jobId: "63f77c27-fd7b-4c65-a834-886c128b6cc1" }) }));
    expect(screen.getByRole("heading", { name: "RNR-2026-ABC123" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open online order" })).toHaveAttribute("href", "/admin/orders/73f77c27-fd7b-4c65-a834-886c128b6cc2");
    expect(screen.getByText("Digital Oil Painting Canvas")).toBeInTheDocument();
    expect(screen.getAllByText("$345.00")).toHaveLength(2);
    expect(screen.getByText("File sent")).toBeInTheDocument();
  });
});
