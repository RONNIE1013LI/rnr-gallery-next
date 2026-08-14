import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { InvoiceNotFoundError } from "@/server/invoices/invoice-service";
import { createAdminInvoicePdfRoute } from "./route-handler";

const origin = "http://localhost:3000";
const invoiceId = "00000000-0000-4000-8000-000000000010";
const context = { params: Promise.resolve({ invoiceId }) };

describe("admin invoice PDF route", () => {
  it("requires finance-view permission before loading invoice data", async () => {
    const getDocument = vi.fn();
    const route = createAdminInvoicePdfRoute({
      requirePermission: vi.fn().mockRejectedValue(new HttpError("Forbidden", 403)),
      getDocument,
      createPdf: vi.fn(),
      recordDownload: vi.fn(),
    });
    const response = await route.GET(new Request(`${origin}/api/admin/invoices/${invoiceId}/pdf`), context);
    expect(response.status).toBe(403);
    expect(getDocument).not.toHaveBeenCalled();
  });

  it("returns an audited private PDF attachment", async () => {
    const bytes = new TextEncoder().encode("%PDF-test");
    const invoice = { id: invoiceId, invoiceNumber: "INV-RRM-2026-ABC123" };
    const recordDownload = vi.fn().mockResolvedValue(undefined);
    const route = createAdminInvoicePdfRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "admin-1", email: "owner@example.test" },
        adminRole: "admin",
      }),
      getDocument: vi.fn().mockResolvedValue(invoice),
      createPdf: vi.fn().mockResolvedValue(bytes),
      recordDownload,
    });
    const response = await route.GET(new Request(`${origin}/api/admin/invoices/${invoiceId}/pdf`), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="INV-RRM-2026-ABC123.pdf"');
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(Array.from(bytes));
    expect(recordDownload).toHaveBeenCalledWith({
      actor: { userId: "admin-1", email: "owner@example.test" },
      invoiceId,
      invoiceNumber: "INV-RRM-2026-ABC123",
      requestSource: "direct",
    });
  });

  it("returns 404 when an invoice does not exist", async () => {
    const route = createAdminInvoicePdfRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "admin-1", email: "owner@example.test" },
        adminRole: "admin",
      }),
      getDocument: vi.fn().mockRejectedValue(new InvoiceNotFoundError()),
      createPdf: vi.fn(),
      recordDownload: vi.fn(),
    });
    const response = await route.GET(new Request(`${origin}/api/admin/invoices/${invoiceId}/pdf`), context);
    expect(response.status).toBe(404);
  });
});
