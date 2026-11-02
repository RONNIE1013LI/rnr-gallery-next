import { sql } from "drizzle-orm";
import { z } from "zod";
import { createAdminCustomerVoucherRoute } from "@/app/api/admin/customers/[customerKey]/voucher/route-handler";
import { THANK_YOU_OFFER_ENABLED, VOUCHER_ORDER_REFERENCE_PATTERN } from "@/domain/promotions/thank-you-offer";
import { getAdminProductionRuntime } from "@/server/admin/admin-production-runtime";
import type { AdminPermission } from "@/server/auth/admin-permissions";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { HttpError } from "@/server/auth/require-session";
import { isReturningOfferEligible } from "@/server/checkout/first-order-offer";
import { getDatabase } from "@/server/db/client";
import { user } from "@/server/db/schema";
import { requireFormPermission, type FormAccess } from "@/server/forms/require-forms";
import type { FormPermission } from "@/server/forms/forms-permissions";
import { assertTrustedMutationRequest, MutationRequestError, parseBoundedJson } from "@/server/http/mutation-request";

type SavedJob = Readonly<{
  source: "manual" | "web";
  jobNumber: string;
  customerName: string;
  customerEmail: string;
  assignedUserId: string | null;
  updatedAt: Date;
}>;
type Context = Readonly<{ params: Promise<{ jobId: string }> }>;
type Dependencies = Readonly<{
  requirePermission: (permission: FormPermission) => Promise<FormAccess>;
  requireAdminPermission: (permission: AdminPermission) => Promise<unknown>;
  detail: (jobId: string) => Promise<{ job: SavedJob } | null>;
  accountForEmail: (email: string) => Promise<string | null>;
  canIssue: (customerId: string) => Promise<boolean>;
  issue: ReturnType<typeof createAdminCustomerVoucherRoute>["POST"];
  enabled: boolean;
  trustedOrigin?: string;
}>;
const noStore = { "Cache-Control": "no-store" };
const inputSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  previousOrderNumber: z.string().max(100).regex(VOUCHER_ORDER_REFERENCE_PATTERN),
  verified: z.literal(true),
}).strict();
const unavailable = "An offer is already reserved or this returning-customer voucher has been used. Resume the existing order or review the customer account.";
const registerFirst = "The customer must register an account using this saved email before a voucher can be generated.";

function errorResponse(error: unknown) {
  const known = error instanceof HttpError || error instanceof MutationRequestError;
  return Response.json({ error: known ? error.message : "The voucher could not be loaded or generated." }, { status: known ? error.status : 500, headers: noStore });
}

export function createFormsJobVoucherRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => ({
    requirePermission: requireFormPermission,
    requireAdminPermission,
    detail: (jobId) => getAdminProductionRuntime().detail(jobId, { canViewFinance: false }),
    accountForEmail: async (email) => {
      const accounts = await getDatabase().select({ id: user.id }).from(user)
        .where(sql`lower(${user.email}) = ${email.trim().toLowerCase()}`).limit(2);
      return accounts.length === 1 ? accounts[0].id : null;
    },
    canIssue: (customerId) => isReturningOfferEligible(getDatabase(), customerId),
    issue: createAdminCustomerVoucherRoute().POST,
    enabled: THANK_YOU_OFFER_ENABLED,
  });

  async function savedContext(deps: Dependencies, context: Context) {
    const access = await deps.requirePermission("view_jobs");
    await deps.requirePermission("view_customer_contact");
    await deps.requireAdminPermission("view_customers");
    await deps.requireAdminPermission("manage_prices");
    if (!deps.enabled) throw new HttpError("The thank-you offer is currently unavailable.", 409);
    const { jobId } = await context.params;
    const detail = await deps.detail(jobId);
    if (!detail || (access.formProfile?.assignedOnly && detail.job.assignedUserId !== access.user.id)) {
      throw new HttpError("Order not found.", 404);
    }
    const job = detail.job;
    const orderNumber = job.jobNumber.trim();
    if (!VOUCHER_ORDER_REFERENCE_PATTERN.test(orderNumber)) {
      throw new HttpError("Choose a saved order with a valid order reference.", 422);
    }
    return { jobId, job, orderNumber };
  }

  return {
    async GET(_request: Request, context: Context) {
      try {
        const deps = dependencies ?? defaults();
        const { jobId, job, orderNumber } = await savedContext(deps, context);
        const customerKey = job.customerEmail.trim() ? await deps.accountForEmail(job.customerEmail) : null;
        const canIssue = Boolean(customerKey && await deps.canIssue(customerKey));
        return Response.json({
          jobId, orderNumber, customerName: job.customerName, customerEmail: job.customerEmail,
          customerKey, expectedUpdatedAt: job.updatedAt.toISOString(), canIssue,
          ...(!canIssue ? { message: customerKey ? unavailable : registerFirst } : {}),
        }, { headers: noStore });
      } catch (error) { return errorResponse(error); }
    },
    async POST(request: Request, context: Context) {
      try {
        const deps = dependencies ?? defaults();
        const { job, orderNumber } = await savedContext(deps, context);
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        let input;
        try { input = inputSchema.safeParse(await parseBoundedJson(request, 1024)); }
        catch (error) {
          if (error instanceof MutationRequestError) throw error;
          throw new HttpError("Confirm the saved order before generating a voucher.", 422);
        }
        if (!input.success) throw new HttpError("Confirm the saved order before generating a voucher.", 422);
        if (input.data.expectedUpdatedAt !== job.updatedAt.toISOString() || input.data.previousOrderNumber !== orderNumber) {
          throw new HttpError("The order has changed. Save your changes and reopen Generate voucher to review the current customer and order.", 409);
        }
        const customerKey = job.customerEmail.trim() ? await deps.accountForEmail(job.customerEmail) : null;
        if (!customerKey) throw new HttpError(registerFirst, 422);
        const issuanceRequest = new Request(request.url, {
          method: "POST", headers: request.headers, body: JSON.stringify(input.data),
        });
        return await deps.issue(issuanceRequest, { params: Promise.resolve({ customerKey }) });
      } catch (error) { return errorResponse(error); }
    },
  };
}

const route = createFormsJobVoucherRoute();
export const GET = route.GET;
export const POST = route.POST;
