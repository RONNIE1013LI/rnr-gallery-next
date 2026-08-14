import { describe, expect, it, vi } from "vitest";
import { createFormsInvoicePdfRoute } from "./route-handler";

const invoiceId = "00000000-0000-4000-8000-000000000010";
const jobId = "00000000-0000-4000-8000-000000000001";

describe("forms invoice PDF route", () => {
  it("checks finance permission and invoice job scope before returning an audited PDF", async () => {
    const access = {
      user: { id: "finance-1", email: "finance@example.test" }, formRole: "form_staff" as const,
      formProfile: { preset: "finance" as const, assignedOnly: false, permissions: { view_finance: true } as never },
    };
    const assertScope = vi.fn().mockResolvedValue(undefined);
    const bytes = new TextEncoder().encode("%PDF-test");
    const recordDownload = vi.fn().mockResolvedValue(undefined);
    const route = createFormsInvoicePdfRoute({
      requirePermission: vi.fn().mockResolvedValue(access), assertScope,
      getDocument: vi.fn().mockResolvedValue({ id: invoiceId, jobId, invoiceNumber: "INV-RRM-2026-ABC123" }),
      createPdf: vi.fn().mockResolvedValue(bytes), recordDownload,
    });
    const response = await route.GET(new Request(`https://shop.example.test/api/forms/invoices/${invoiceId}/pdf`), {
      params: Promise.resolve({ invoiceId }),
    });
    expect(response.status).toBe(200);
    expect(assertScope).toHaveBeenCalledWith(access, jobId);
    expect(recordDownload).toHaveBeenCalledWith(expect.objectContaining({ invoiceId }));
  });
});
