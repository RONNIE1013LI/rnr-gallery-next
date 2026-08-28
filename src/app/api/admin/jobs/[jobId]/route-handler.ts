import { after } from "next/server";
import { getAdminProductionRuntime } from "@/server/admin/admin-production-runtime";
import { recordAdminFailure } from "@/server/admin/admin-failure-audit";
import { hasAdminPermission, type AdminPermission } from "@/server/auth/admin-permissions";
import { requireAdminPermission, type AdminAccess } from "@/server/auth/require-admin";
import { HttpError } from "@/server/auth/require-session";
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

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };

type Access = AdminAccess<Readonly<{ user: Readonly<{ id: string; email?: string }> }>>;
type ProductionRuntime = ReturnType<typeof getAdminProductionRuntime>;
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<Access>;
  update: ProductionRuntime["update"];
  trustedOrigin?: string;
  recordFailure?: typeof recordAdminFailure;
}>;
type Context = Readonly<{ params: Promise<{ jobId: string }> }>;

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
  return Response.json(
    { error: "The production job could not be updated." },
    { status: 500, headers: noStore },
  );
}

function requestSource(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "direct";
}

export function createAdminJobRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const production = getAdminProductionRuntime({ scheduleAfter: (task) => after(task) });
    return {
      requirePermission: requireAdminPermission,
      update: production.update,
      recordFailure: recordAdminFailure,
    };
  };
  return {
    async PATCH(request: Request, context: Context) {
      const deps = dependencies ?? defaults();
      let actor: Readonly<{ userId: string; email: string }> | null = null;
      let jobId: string | undefined;
      let idempotencyKey: string | undefined;
      try {
        const access = await deps.requirePermission("update_production_jobs");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        ({ jobId } = await context.params);
        actor = {
          userId: access.user.id,
          email: access.user.email ?? "unknown@invalid.local",
        };
        const body = await parseBoundedJson(request) as Record<string, unknown>;
        idempotencyKey = typeof body.idempotencyKey === "string"
          ? body.idempotencyKey
          : undefined;
        const result = await deps.update(actor, { ...body, jobId }, {
          canUpdateFinance: hasAdminPermission(
            access.adminRole,
            access.adminPermissions,
            "update_production_finance",
          ),
        });
        return Response.json({ result }, { headers: noStore });
      } catch (error) {
        if (actor && deps.recordFailure) {
          await deps.recordFailure({
            actor,
            action: "production_job.update.failed",
            resourceType: "production_job",
            ...(jobId ? { resourceId: jobId } : {}),
            requestSource: requestSource(request),
            ...(idempotencyKey ? { idempotencyKey } : {}),
            error,
          });
        }
        return errorResponse(error);
      }
    },
  };
}

const route = createAdminJobRoute();
export const PATCH = route.PATCH;
