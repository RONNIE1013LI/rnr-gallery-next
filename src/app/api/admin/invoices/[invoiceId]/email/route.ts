import { getAdminInvoiceRuntime } from "@/server/admin/admin-invoice-runtime";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { HttpError } from "@/server/auth/require-session";
import { assertTrustedMutationRequest, parseBoundedJson, MutationRequestError } from "@/server/http/mutation-request";
import { InvoiceNotFoundError } from "@/server/invoices/invoice-service";
export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  try {
    await requireAdminPermission("view_production_finance");
    return Response.json({ attempt: await getAdminInvoiceRuntime().latestEmailAttempt((await params).invoiceId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Unable to load invoice email history." }, { status: 500 });
  }
}
export async function POST(request: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  try {
    const access = await requireAdminPermission("update_production_finance");
    assertTrustedMutationRequest(request);
    const body = await parseBoundedJson(request) as Record<string, unknown>;
    const invoice = await getAdminInvoiceRuntime().getDocument((await params).invoiceId);
    const prior = await getAdminInvoiceRuntime().latestEmailAttempt(invoice.id);
    const service = getAdminInvoiceRuntime().createEmailService({ userId: access.user.id, email: access.user.email ?? "unknown@invalid.local" }, { source: "manual", trigger: prior ? "manual_resend" : "manual_send" });
    const result = await service.send(invoice, { recipientEmail: typeof body.recipientEmail === "string" ? body.recipientEmail : undefined, subject: typeof body.subject === "string" ? body.subject : undefined, body: typeof body.body === "string" ? body.body : undefined, idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : "" });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof HttpError || error instanceof MutationRequestError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof InvoiceNotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ error: error instanceof Error ? error.message : "Invoice email failed." }, { status: 422 });
  }
}
