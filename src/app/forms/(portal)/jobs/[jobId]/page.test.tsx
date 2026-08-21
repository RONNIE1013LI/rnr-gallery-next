import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import FormsJobDetailPage from "./page";

const { requireFormsPage, detail, assignees, listFiles, listNotifications, notFound } = vi.hoisted(() => ({
  requireFormsPage: vi.fn(),
  detail: vi.fn(),
  assignees: vi.fn().mockResolvedValue([]),
  listFiles: vi.fn().mockResolvedValue({
    files: [],
    revision: { changesRequested: 0, freeRevisionsRemaining: 2, requiresAdditionalChargeReview: false },
  }),
  listNotifications: vi.fn().mockResolvedValue([]),
  notFound: vi.fn(() => { throw new Error("not found"); }),
}));

vi.mock("@/server/forms/require-forms-page", () => ({ requireFormsPage }));
vi.mock("@/server/admin/admin-production-runtime", () => ({
  getAdminProductionRuntime: () => ({ detail, assignees }),
}));
vi.mock("@/server/admin/admin-production-proof-runtime", () => ({
  getAdminProductionProofRuntime: () => ({ listFiles }),
}));
vi.mock("@/server/notifications/customer-notification-runtime", () => ({
  getCustomerNotificationRuntime: () => ({ listForJob: listNotifications }),
}));
vi.mock("next/navigation", () => ({ notFound, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/admin/production-job-detail", () => ({
  ProductionJobDetail: (props: {
    detail: { job: { customerEmail: string; customerPhone: string }; finance: unknown; audit: unknown[] };
    jobApiBase: string;
    invoicePdfBase: string;
    notificationRetryEndpoint: string;
    canManageFinance: boolean;
  }) => <div
    data-testid="forms-job-detail"
    data-email={props.detail.job.customerEmail}
    data-phone={props.detail.job.customerPhone}
    data-finance={String(Boolean(props.detail.finance))}
    data-audit={String(props.detail.audit.length)}
    data-job-api={props.jobApiBase}
    data-invoice-api={props.invoicePdfBase}
    data-notification-api={props.notificationRetryEndpoint}
    data-finance-edit={String(props.canManageFinance)}
    data-manual-entry={String((props as { manualEntryLayout?: boolean }).manualEntryLayout)}
  />,
}));
vi.mock("@/components/forms/existing-manual-production-job-form", () => ({
  ExistingManualProductionJobForm: (props: {
    detail: { job: { customerEmail: string; customerPhone: string }; finance: unknown; audit: unknown[] };
    jobApiBase: string;
    invoicePdfBase: string;
    canManageFinance: boolean;
  }) => <div
    data-testid="forms-job-detail"
    data-email={props.detail.job.customerEmail}
    data-phone={props.detail.job.customerPhone}
    data-finance={String(Boolean(props.detail.finance))}
    data-audit={String(props.detail.audit.length)}
    data-job-api={props.jobApiBase}
    data-invoice-api={props.invoicePdfBase}
    data-finance-edit={String(props.canManageFinance)}
    data-manual-entry="true"
  />,
}));

const params = Promise.resolve({ jobId: "550e8400-e29b-41d4-a716-446655440000" });
const privateDetail = {
  job: {
    id: "550e8400-e29b-41d4-a716-446655440000",
    jobNumber: "RNR-2026-ABC123",
    assignedUserId: "artist-1",
    source: "manual",
    orderId: null,
    customerEmail: "private@example.test",
    customerPhone: "0210000000",
  },
  finance: { amountPayableCents: 23000 },
  audit: [{ id: "audit-1" }],
};

describe("forms job detail page", () => {
  it("uses forms endpoints and projects sensitive data from staff permissions", async () => {
    requireFormsPage.mockResolvedValue({
      user: { id: "artist-1", email: "artist@example.test" },
      formRole: "form_staff",
      formProfile: {
        preset: "artist",
        assignedOnly: true,
        permissions: {
          view_jobs: true,
          view_customer_contact: false,
          view_finance: false,
          view_audit: false,
          view_files: true,
          update_finance: false,
        },
      },
    });
    detail.mockResolvedValue(privateDetail);

    render(await FormsJobDetailPage({ params }));

    expect(requireFormsPage).toHaveBeenCalledWith(
      "/order-system/jobs/550e8400-e29b-41d4-a716-446655440000",
      "view_jobs",
    );
    const rendered = screen.getByTestId("forms-job-detail");
    expect(rendered).toHaveAttribute("data-email", "");
    expect(rendered).toHaveAttribute("data-phone", "");
    expect(rendered).toHaveAttribute("data-finance", "false");
    expect(rendered).toHaveAttribute("data-audit", "0");
    expect(rendered).toHaveAttribute("data-job-api", "/api/forms/jobs");
    expect(rendered).toHaveAttribute("data-invoice-api", "/api/forms/invoices");
    expect(rendered).toHaveAttribute("data-finance-edit", "false");
    expect(rendered).toHaveAttribute("data-manual-entry", "true");
  });

  it("does not expose a job outside an assigned-only staff member's scope", async () => {
    requireFormsPage.mockResolvedValue({
      user: { id: "artist-2", email: "artist2@example.test" },
      formRole: "form_staff",
      formProfile: { preset: "artist", assignedOnly: true, permissions: { view_jobs: true } },
    });
    detail.mockResolvedValue(privateDetail);
    await expect(FormsJobDetailPage({ params })).rejects.toThrow("not found");
    expect(notFound).toHaveBeenCalled();
  });

  it("shows Web- only for the displayed web-order reference", async () => {
    requireFormsPage.mockResolvedValue({
      user: { id: "artist-1", email: "artist@example.test" },
      formRole: "owner",
      formProfile: null,
    });
    detail.mockResolvedValue({ ...privateDetail, job: { ...privateDetail.job, source: "web" } });

    render(await FormsJobDetailPage({ params }));

    expect(screen.getByRole("heading", { level: 1, name: "Web-RNR-2026-ABC123" })).toBeInTheDocument();
    expect(screen.getByText("Web-RNR-2026-ABC123", { selector: "nav span" })).toBeInTheDocument();
  });
});
