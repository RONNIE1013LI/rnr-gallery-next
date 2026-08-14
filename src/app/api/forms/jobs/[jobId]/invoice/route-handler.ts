import { getAdminInvoiceRuntime } from "@/server/admin/admin-invoice-runtime";
import { recordAdminFailure } from "@/server/admin/admin-failure-audit";
import { HttpError } from "@/server/auth/require-session";
import { assertFormsJobScope } from "@/server/forms/forms-job-scope";
import type { FormPermission } from "@/server/forms/forms-permissions";
import { requireFormPermission, type FormAccess } from "@/server/forms/require-forms";
import { assertTrustedMutationRequest, MutationRequestError, parseBoundedJson } from "@/server/http/mutation-request";
import { InvoiceConflictError, InvoiceImmutableError, InvoiceNotFoundError, InvoiceRequestValidationError } from "@/server/invoices/invoice-service";
import { ProductionJobNotFoundError } from "@/server/production/production-job-service";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
type Access = FormAccess<Readonly<{ user: Readonly<{ id: string; email?: string }> }>>;
type InvoiceRuntime = ReturnType<typeof getAdminInvoiceRuntime>;
type Dependencies = Readonly<{
  requirePermission: (permission: FormPermission) => Promise<Access>;
  assertScope: typeof assertFormsJobScope;
  getOrCreateDraft: InvoiceRuntime["getOrCreateDraft"];
  updateDraft: InvoiceRuntime["updateDraft"];
  issue: InvoiceRuntime["issue"];
  void: InvoiceRuntime["void"];
  trustedOrigin?: string;
  recordFailure?: typeof recordAdminFailure;
}>;
type Context = Readonly<{ params: Promise<{ jobId: string }> }>;

function actor(access: Access) {
  return { userId: access.user.id, email: access.user.email ?? "unknown@invalid.local" };
}

function errorResponse(error: unknown) {
  if (error instanceof HttpError || error instanceof MutationRequestError) return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  if (error instanceof ProductionJobNotFoundError || error instanceof InvoiceNotFoundError) return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
  if (error instanceof InvoiceRequestValidationError) return Response.json({ error: error.message }, { status: 422, headers: noStore });
  if (error instanceof InvoiceConflictError || error instanceof InvoiceImmutableError) return Response.json({ error: error.message }, { status: 409, headers: noStore });
  return Response.json({ error: "The invoice request could not be completed." }, { status: 500, headers: noStore });
}

function requestSource(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "direct";
}

export function createFormsJobInvoiceRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const invoices = getAdminInvoiceRuntime();
    return {
      requirePermission: requireFormPermission,
      assertScope: assertFormsJobScope,
      getOrCreateDraft: invoices.getOrCreateDraft,
      updateDraft: invoices.updateDraft,
      issue: invoices.issue,
      void: invoices.void,
      recordFailure: recordAdminFailure,
    };
  };
  return {
    async GET(_request: Request, context: Context) {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("view_finance");
        const { jobId } = await context.params;
        await deps.assertScope(access, jobId);
        return Response.json({ invoice: await deps.getOrCreateDraft(actor(access), jobId) }, { headers: noStore });
      } catch (error) {
        return errorResponse(error);
      }
    },
    async PUT(request: Request, context: Context) {
      const deps = dependencies ?? defaults();
      let authenticated: ReturnType<typeof actor> | null = null;
      let invoiceId: string | undefined;
      let idempotencyKey: string | undefined;
      try {
        const access = await deps.requirePermission("update_finance");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const { jobId } = await context.params;
        await deps.assertScope(access, jobId);
        authenticated = actor(access);
        const body = await parseBoundedJson(request) as Record<string, unknown>;
        invoiceId = typeof body.invoiceId === "string" ? body.invoiceId : undefined;
        idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined;
        return Response.json({ invoice: await deps.updateDraft(authenticated, body) }, { headers: noStore });
      } catch (error) {
        if (authenticated && deps.recordFailure) await deps.recordFailure({
          actor: authenticated, action: "invoice.update.failed", resourceType: "invoice",
          ...(invoiceId ? { resourceId: invoiceId } : {}), requestSource: requestSource(request),
          ...(idempotencyKey ? { idempotencyKey } : {}), error,
        });
        return errorResponse(error);
      }
    },
    async POST(request: Request, context: Context) {
      const deps = dependencies ?? defaults();
      let authenticated: ReturnType<typeof actor> | null = null;
      let invoiceId: string | undefined;
      let idempotencyKey: string | undefined;
      try {
        const access = await deps.requirePermission("update_finance");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const { jobId } = await context.params;
        await deps.assertScope(access, jobId);
        authenticated = actor(access);
        const body = await parseBoundedJson(request) as Record<string, unknown>;
        const { action, ...input } = body;
        invoiceId = typeof input.invoiceId === "string" ? input.invoiceId : undefined;
        idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey : undefined;
        const invoice = action === "issue" ? await deps.issue(authenticated, input)
          : action === "void" ? await deps.void(authenticated, input)
            : (() => { throw new InvoiceRequestValidationError(); })();
        return Response.json({ invoice }, { headers: noStore });
      } catch (error) {
        if (authenticated && deps.recordFailure) await deps.recordFailure({
          actor: authenticated, action: "invoice.lifecycle.failed", resourceType: "invoice",
          ...(invoiceId ? { resourceId: invoiceId } : {}), requestSource: requestSource(request),
          ...(idempotencyKey ? { idempotencyKey } : {}), error,
        });
        return errorResponse(error);
      }
    },
  };
}

const route = createFormsJobInvoiceRoute();
export const GET = route.GET;
export const PUT = route.PUT;
export const POST = route.POST;
