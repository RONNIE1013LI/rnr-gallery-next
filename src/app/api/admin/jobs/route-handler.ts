import { getAdminProductionRuntime } from "@/server/admin/admin-production-runtime";
import { recordAdminFailure } from "@/server/admin/admin-failure-audit";
import {
  hasAdminPermission,
  type AdminPermission,
  type AdminRole,
} from "@/server/auth/admin-permissions";
import { requireAdminPermission } from "@/server/auth/require-admin";
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
  parseProductionJobFilters,
} from "@/server/production/production-job-service";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };

type Access = Readonly<{
  user: Readonly<{ id: string; email?: string }>;
  adminRole: AdminRole;
}>;
type ProductionRuntime = ReturnType<typeof getAdminProductionRuntime>;
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<Access>;
  list: ProductionRuntime["list"];
  createManual: ProductionRuntime["createManual"];
  trustedOrigin?: string;
  recordFailure?: typeof recordAdminFailure;
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
  return Response.json(
    { error: "The production job could not be saved." },
    { status: 500, headers: noStore },
  );
}

function actorFrom(access: Access) {
  return {
    userId: access.user.id,
    email: access.user.email ?? "unknown@invalid.local",
  };
}

function requestSource(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "direct";
}

export function createAdminJobsRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const production = getAdminProductionRuntime();
    return {
      requirePermission: requireAdminPermission,
      list: production.list,
      createManual: production.createManual,
      recordFailure: recordAdminFailure,
    };
  };
  return {
    async GET(request: Request) {
      const deps = dependencies ?? defaults();
      try {
        const access = await deps.requirePermission("view_production_jobs");
        const url = new URL(request.url);
        const filters = parseProductionJobFilters(
          Object.fromEntries(url.searchParams.entries()),
        );
        const result = await deps.list(filters, {
          canViewFinance: hasAdminPermission(
            access.adminRole,
            "view_production_finance",
          ),
        });
        return Response.json(result, { headers: noStore });
      } catch (error) {
        return errorResponse(error);
      }
    },

    async POST(request: Request) {
      const deps = dependencies ?? defaults();
      let actor: ReturnType<typeof actorFrom> | null = null;
      let idempotencyKey: string | undefined;
      try {
        const access = await deps.requirePermission("create_manual_jobs");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        actor = actorFrom(access);
        const body = await parseBoundedJson(request) as Record<string, unknown>;
        idempotencyKey = typeof body.idempotencyKey === "string"
          ? body.idempotencyKey
          : undefined;
        const result = await deps.createManual(actor, body, {
          canUpdateFinance: hasAdminPermission(
            access.adminRole,
            "update_production_finance",
          ),
        });
        return Response.json(result, {
          status: result.result === "created" ? 201 : 200,
          headers: noStore,
        });
      } catch (error) {
        if (actor && deps.recordFailure) {
          await deps.recordFailure({
            actor,
            action: "production_job.create.failed",
            resourceType: "production_job",
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

const route = createAdminJobsRoute();
export const GET = route.GET;
export const POST = route.POST;
