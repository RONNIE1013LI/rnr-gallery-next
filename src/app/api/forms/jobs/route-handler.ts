import { HttpError } from "@/server/auth/require-session";
import { after } from "next/server";
import { listFormOrders } from "@/server/forms/drizzle-forms-workbench-repository";
import { hasFormPermission } from "@/server/forms/forms-permissions";
import { requireFormPermission, type FormAccess } from "@/server/forms/require-forms";
import { parseFormWorkbenchQuery } from "@/server/forms/forms-workbench-service";
import type { FormWorkbenchAccess } from "@/server/forms/drizzle-forms-workbench-repository";
import type { FormWorkbenchQuery } from "@/server/forms/forms-workbench-service";
import { getAdminProductionRuntime } from "@/server/admin/admin-production-runtime";
import {
  assertTrustedMutationRequest,
  parseBoundedJson,
  MutationRequestError,
} from "@/server/http/mutation-request";
import {
  ProductionJobConflictError,
  ProductionJobNotFoundError,
  ProductionJobValidationError,
} from "@/server/production/production-job-service";
import type { FormPermission } from "@/server/forms/forms-permissions";
import { createImmediateNotificationDeliveryObserver } from "@/server/notifications/immediate-notification-delivery";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };

type Access = FormAccess<Readonly<{
  user: Readonly<{ id: string; name?: string; email?: string }>;
}>>;

type Dependencies = Readonly<{
  requirePermission: (permission: Extract<FormPermission, "view_jobs" | "create_jobs">) => Promise<Access>;
  list: (query: FormWorkbenchQuery, access: FormWorkbenchAccess) => ReturnType<typeof listFormOrders>;
  createManual?: ReturnType<typeof getAdminProductionRuntime>["createManual"];
  trustedOrigin?: string;
}>;

function errorResponse(error: unknown) {
  if (error instanceof HttpError || error instanceof MutationRequestError) {
    return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof ProductionJobValidationError) {
    return Response.json({ error: error.message }, { status: 422, headers: noStore });
  }
  if (error instanceof ProductionJobNotFoundError) {
    return Response.json({ error: error.message }, { status: 404, headers: noStore });
  }
  if (error instanceof ProductionJobConflictError) {
    return Response.json({ error: error.message }, { status: 409, headers: noStore });
  }
  return Response.json({ error: "The production job could not be saved." }, { status: 500, headers: noStore });
}

export function createFormsJobsRoute(dependencies?: Dependencies) {
  return {
    async GET(request: Request) {
      try {
        const deps: Dependencies = dependencies ?? (() => {
          const production = getAdminProductionRuntime(
            createImmediateNotificationDeliveryObserver({
              scheduleAfter: (task) => after(task),
            }),
          );
          return {
            requirePermission: requireFormPermission,
            list: async (query: FormWorkbenchQuery, access: FormWorkbenchAccess) => {
              const { getDatabase } = await import("@/server/db/client");
              return listFormOrders(getDatabase(), query, access);
            },
            createManual: production.createManual,
          };
        })();
        const access = await deps.requirePermission("view_jobs");
        const { searchParams } = new URL(request.url);
        const query = parseFormWorkbenchQuery(Object.fromEntries(
          [...searchParams.keys()].map((key) => {
            const values = searchParams.getAll(key);
            return [key, values.length > 1 ? values : values[0]];
          }),
        ));
        const result = await deps.list(query, {
          actorUserId: access.user.id,
          assignedOnly: access.formProfile?.assignedOnly ?? false,
          canViewCustomerContact: hasFormPermission(
            access.formRole,
            access.formProfile,
            "view_customer_contact",
          ),
          canViewFinance: hasFormPermission(
            access.formRole,
            access.formProfile,
            "view_finance",
          ),
          canViewPaymentProof: hasFormPermission(
            access.formRole,
            access.formProfile,
            "view_payment_proof",
          ),
        });
        return Response.json(result, { headers: noStore });
      } catch (error) {
        return errorResponse(error);
      }
    },
    async POST(request: Request) {
      try {
        const deps: Dependencies = dependencies ?? (() => {
          const production = getAdminProductionRuntime(
            createImmediateNotificationDeliveryObserver({
              scheduleAfter: (task) => after(task),
            }),
          );
          return {
            requirePermission: requireFormPermission,
            list: async (query: FormWorkbenchQuery, access: FormWorkbenchAccess) => {
              const { getDatabase } = await import("@/server/db/client");
              return listFormOrders(getDatabase(), query, access);
            },
            createManual: production.createManual,
          };
        })();
        const access = await deps.requirePermission("create_jobs");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        if (!deps.createManual) throw new Error("Manual entry runtime is unavailable");
        const result = await deps.createManual(
          { userId: access.user.id, email: access.user.email ?? "unknown@invalid.local" },
          await parseBoundedJson(request),
          { canUpdateFinance: hasFormPermission(access.formRole, access.formProfile, "update_finance") },
        );
        return Response.json(result, { status: result.result === "created" ? 201 : 200, headers: noStore });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

const route = createFormsJobsRoute();
export const GET = route.GET;
export const POST = route.POST;
