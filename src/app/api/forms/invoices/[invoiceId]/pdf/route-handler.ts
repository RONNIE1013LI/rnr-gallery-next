import { getAdminInvoiceRuntime } from "@/server/admin/admin-invoice-runtime";
import { HttpError } from "@/server/auth/require-session";
import { assertFormsJobScope } from "@/server/forms/forms-job-scope";
import type { FormPermission } from "@/server/forms/forms-permissions";
import { requireFormPermission, type FormAccess } from "@/server/forms/require-forms";
import { createInvoicePdf } from "@/server/invoices/invoice-pdf";
import { InvoiceNotFoundError, InvoiceRequestValidationError } from "@/server/invoices/invoice-service";
import { ProductionJobNotFoundError } from "@/server/production/production-job-service";

export const runtime = "nodejs";
type Access = FormAccess<Readonly<{ user: Readonly<{ id: string; email?: string }> }>>;
type InvoiceRuntime = ReturnType<typeof getAdminInvoiceRuntime>;
type Dependencies = Readonly<{
  requirePermission: (permission: FormPermission) => Promise<Access>;
  assertScope: typeof assertFormsJobScope;
  getDocument: InvoiceRuntime["getDocument"];
  createPdf: typeof createInvoicePdf;
  recordDownload: InvoiceRuntime["recordDownload"];
}>;
type Context = Readonly<{ params: Promise<{ invoiceId: string }> }>;

function requestSource(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "direct";
}

function safeFilename(invoiceNumber: string) {
  return `${invoiceNumber.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 100) || "invoice"}.pdf`;
}

export function createFormsInvoicePdfRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const invoices = getAdminInvoiceRuntime();
    return {
      requirePermission: requireFormPermission,
      assertScope: assertFormsJobScope,
      getDocument: invoices.getDocument,
      createPdf: createInvoicePdf,
      recordDownload: invoices.recordDownload,
    };
  };
  return {
    async GET(request: Request, context: Context) {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("view_finance");
        const { invoiceId } = await context.params;
        const invoice = await deps.getDocument(invoiceId);
        await deps.assertScope(access, invoice.jobId);
        const bytes = await deps.createPdf(invoice);
        await deps.recordDownload({
          actor: { userId: access.user.id, email: access.user.email ?? "unknown@invalid.local" },
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          requestSource: requestSource(request),
        });
        return new Response(bytes.slice().buffer as ArrayBuffer, { headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${safeFilename(invoice.invoiceNumber)}"`,
          "Content-Length": String(bytes.byteLength),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        } });
      } catch (error) {
        const headers = { "Cache-Control": "no-store" };
        if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers });
        if (error instanceof InvoiceNotFoundError || error instanceof ProductionJobNotFoundError) return Response.json({ error: "Not found" }, { status: 404, headers });
        if (error instanceof InvoiceRequestValidationError) return Response.json({ error: error.message }, { status: 422, headers });
        return Response.json({ error: "The invoice PDF could not be created." }, { status: 500, headers });
      }
    },
  };
}

const route = createFormsInvoicePdfRoute();
export const GET = route.GET;
