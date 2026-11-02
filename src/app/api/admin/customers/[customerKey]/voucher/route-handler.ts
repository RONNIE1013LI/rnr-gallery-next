import { randomUUID } from "node:crypto";
import { THANK_YOU_OFFER_ENABLED } from "@/domain/promotions/thank-you-offer";
import { getAdminCustomerRuntime } from "@/server/admin/admin-customer-runtime";
import { writeAdminAudit, type AdminAuditInput } from "@/server/admin/audit-service";
import type { AdminPermission } from "@/server/auth/admin-permissions";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { HttpError } from "@/server/auth/require-session";
import { isReturningOfferEligible } from "@/server/checkout/first-order-offer";
import { createReturningCustomerVoucher } from "@/server/checkout/returning-customer-voucher";
import { getDatabase } from "@/server/db/client";
import { assertTrustedMutationRequest, MutationRequestError, parseBoundedJson } from "@/server/http/mutation-request";

type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<{ user: { id: string; email?: string } }>;
  detail: (key: string) => Promise<{ account: { id: string } | null } | null>;
  audit: (input: AdminAuditInput) => Promise<unknown>;
  canIssue: (customerId: string) => Promise<boolean>;
  secret: () => string;
  enabled: boolean;
  trustedOrigin?: string;
}>;
type Context = Readonly<{ params: Promise<{ customerKey: string }> }>;
const noStore = { "Cache-Control": "no-store" };

export function createAdminCustomerVoucherRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => ({
    requirePermission: requireAdminPermission,
    detail: (key) => getAdminCustomerRuntime().detail(key),
    audit: async (input) => writeAdminAudit(getDatabase(), input),
    canIssue: (customerId) => isReturningOfferEligible(getDatabase(), customerId),
    secret: () => process.env.BETTER_AUTH_SECRET ?? "",
    enabled: THANK_YOU_OFFER_ENABLED,
  });
  return {
    async POST(request: Request, context: Context) {
      const deps = dependencies ?? defaults();
      try {
        const access = await deps.requirePermission("view_customers");
        await deps.requirePermission("manage_prices");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        if (!deps.enabled) throw new HttpError("The thank-you offer is currently unavailable.", 409);
        let body: unknown;
        try { body = await parseBoundedJson(request, 1024); }
        catch (error) {
          if (error instanceof MutationRequestError) throw error;
          throw new HttpError("Enter a verified previous order number (5 digits).", 422);
        }
        if (!body || typeof body !== "object" || !("previousOrderNumber" in body) || typeof body.previousOrderNumber !== "string" || !/^[0-9]{5}$/.test(body.previousOrderNumber) || !("verified" in body) || body.verified !== true) {
          throw new HttpError("Enter a verified previous order number (5 digits).", 422);
        }
        const { customerKey } = await context.params;
        const detail = await deps.detail(customerKey);
        if (!detail) throw new HttpError("Customer not found.", 404);
        if (!detail.account) throw new HttpError("The customer must register an account before a voucher can be generated.", 422);
        if (!await deps.canIssue(detail.account.id)) {
          throw new HttpError("An offer is already reserved or this returning-customer voucher has been used. Resume the existing order or review the customer account.", 409);
        }
        const code = createReturningCustomerVoucher(detail.account.id, deps.secret());
        await deps.audit({
          actorUserId: access.user.id,
          actorEmail: access.user.email ?? "unknown@invalid.local",
          action: "customer.returning_voucher.generate",
          resourceType: "customer",
          resourceId: detail.account.id,
          afterSummary: { campaign: "returning-customer-thank-you:v1", previousOrderNumber: body.previousOrderNumber, verified: true },
          result: "success",
          idempotencyKey: `returning-voucher:${randomUUID()}`,
        });
        return Response.json({ code }, { headers: noStore });
      } catch (error) {
        const known = error instanceof HttpError || error instanceof MutationRequestError;
        return Response.json({ error: known ? error.message : "The voucher could not be generated." }, { status: known ? error.status : 500, headers: noStore });
      }
    },
  };
}
export const POST = createAdminCustomerVoucherRoute().POST;
