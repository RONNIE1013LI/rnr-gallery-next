import { getAdminInvoiceRuntime } from "@/server/admin/admin-invoice-runtime";
import type { AdminPermission, AdminRole } from "@/server/auth/admin-permissions";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { HttpError } from "@/server/auth/require-session";
import { createInvoicePdf } from "@/server/invoices/invoice-pdf";
import {
  InvoiceNotFoundError,
  InvoiceRequestValidationError,
} from "@/server/invoices/invoice-service";

export const runtime = "nodejs";

type Access = Readonly<{
  user: Readonly<{ id: string; email?: string }>;
  adminRole: AdminRole;
}>;
type InvoiceRuntime = ReturnType<typeof getAdminInvoiceRuntime>;
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<Access>;
  getDocument: InvoiceRuntime["getDocument"];
  createPdf: typeof createInvoicePdf;
  recordDownload: InvoiceRuntime["recordDownload"];
}>;
type Context = Readonly<{ params: Promise<{ invoiceId: string }> }>;

function requestSource(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() || "direct";
}

function safeFilename(invoiceNumber: string) {
  const filename = invoiceNumber.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 100);
  return `${filename || "invoice"}.pdf`;
}

export function createAdminInvoicePdfRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const invoices = getAdminInvoiceRuntime();
    return {
      requirePermission: requireAdminPermission,
      getDocument: invoices.getDocument,
      createPdf: createInvoicePdf,
      recordDownload: invoices.recordDownload,
    };
  };
  return {
    async GET(request: Request, context: Context) {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("view_production_finance");
        const { invoiceId } = await context.params;
        const invoice = await deps.getDocument(invoiceId);
        const bytes = await deps.createPdf(invoice);
        await deps.recordDownload({
          actor: {
            userId: access.user.id,
            email: access.user.email ?? "unknown@invalid.local",
          },
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          requestSource: requestSource(request),
        });
        return new Response(bytes.slice().buffer as ArrayBuffer, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${safeFilename(invoice.invoiceNumber)}"`,
            "Content-Length": String(bytes.byteLength),
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch (error) {
        if (error instanceof HttpError) {
          return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
        }
        if (error instanceof InvoiceNotFoundError) {
          return Response.json({ error: error.message }, { status: 404, headers: { "Cache-Control": "no-store" } });
        }
        if (error instanceof InvoiceRequestValidationError) {
          return Response.json({ error: error.message }, { status: 422, headers: { "Cache-Control": "no-store" } });
        }
        return Response.json({ error: "The invoice PDF could not be created." }, { status: 500, headers: { "Cache-Control": "no-store" } });
      }
    },
  };
}

const route = createAdminInvoicePdfRoute();
export const GET = route.GET;
