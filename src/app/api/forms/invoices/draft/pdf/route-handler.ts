import { z } from "zod";
import { HttpError } from "@/server/auth/require-session";
import type { FormPermission } from "@/server/forms/forms-permissions";
import { requireFormPermission } from "@/server/forms/require-forms";
import { assertTrustedMutationRequest, MutationRequestError, parseBoundedJson } from "@/server/http/mutation-request";
import { calculateInvoiceTotals, parseInvoiceDraft } from "@/server/invoices/invoice-domain";
import { createInvoicePdf } from "@/server/invoices/invoice-pdf";
import type { InvoiceRecord } from "@/server/invoices/invoice-service";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "private, no-store" };
const envelopeSchema = z.object({ currency: z.enum(["NZD", "AUD"]), gstRateBasisPoints: z.number().int().min(0).max(10_000), draft: z.unknown() }).strict();

type Dependencies = Readonly<{
  requirePermission: (permission: FormPermission) => Promise<unknown>;
  createPdf: typeof createInvoicePdf;
  trustedOrigin?: string;
}>;

export function createDraftInvoicePdfRoute(dependencies?: Dependencies) {
  return async function POST(request: Request) {
    const deps = dependencies ?? { requirePermission: requireFormPermission, createPdf: createInvoicePdf };
    try {
      await deps.requirePermission("update_finance");
      assertTrustedMutationRequest(request, deps.trustedOrigin);
      const envelope = envelopeSchema.parse(await parseBoundedJson(request));
      const draft = parseInvoiceDraft(envelope.draft);
      const totals = calculateInvoiceTotals(draft, envelope.gstRateBasisPoints);
      const now = new Date();
      const invoice: InvoiceRecord = {
        id: "00000000-0000-4000-8000-000000000000", jobId: "00000000-0000-4000-8000-000000000000",
        invoiceNumber: "INV-DRAFT", status: "draft", webOrderNumber: "", currency: envelope.currency,
        gstRateBasisPoints: envelope.gstRateBasisPoints, pricesIncludeGst: true,
        ...draft, ...totals, issuedAt: null, voidedAt: null, voidReason: null, createdAt: now, updatedAt: now,
        items: draft.items.map((item, position) => ({ ...item, position, lineTotalInclGstCents: Math.round(item.quantityMilli * item.rateInclGstCents / 1_000) })),
      };
      const bytes = await deps.createPdf(invoice);
      return new Response(bytes.slice().buffer as ArrayBuffer, { headers: {
        ...noStore, "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=\"INV-DRAFT.pdf\"",
        "Content-Length": String(bytes.byteLength), "X-Content-Type-Options": "nosniff",
      } });
    } catch (error) {
      if (error instanceof HttpError || error instanceof MutationRequestError) return Response.json({ error: error.message }, { status: error.status, headers: noStore });
      if (error instanceof z.ZodError) return Response.json({ error: "Invoice request is invalid" }, { status: 422, headers: noStore });
      return Response.json({ error: "The draft invoice PDF could not be created." }, { status: 422, headers: noStore });
    }
  };
}

export const POST = createDraftInvoicePdfRoute();
