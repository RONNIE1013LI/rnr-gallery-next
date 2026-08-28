import { z } from "zod";
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
  recordConversionEvidence?: ProductionRuntime["recordConversionEvidence"];
  trustedOrigin?: string;
  recordFailure?: typeof recordAdminFailure;
}>;
type Context = Readonly<{ params: Promise<{ jobId: string }> }>;

const evidenceSchema = z.object({
  consentDecision: z.enum(["granted", "denied"]),
  consentRecordedAt: z.string().datetime(),
  source: z.enum(["google", "meta"]),
  attribution: z.object({
    gclid: z.string().trim().min(1).max(200).optional(),
    gbraid: z.string().trim().min(1).max(200).optional(),
    wbraid: z.string().trim().min(1).max(200).optional(),
    fbclid: z.string().trim().min(1).max(200).optional(),
    fbp: z.string().trim().min(1).max(220).optional(),
    fbc: z.string().trim().min(1).max(220).optional(),
  }).strict().optional(),
}).strict();

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
    const production = getAdminProductionRuntime();
    return {
      requirePermission: requireAdminPermission,
      update: production.update,
      recordConversionEvidence: production.recordConversionEvidence,
      recordFailure: recordAdminFailure,
    };
  };
  return {
    async POST(request: Request, context: Context) {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("update_production_finance");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const parsed = evidenceSchema.safeParse(await parseBoundedJson(request));
        if (!parsed.success || !deps.recordConversionEvidence) {
          throw new ProductionJobValidationError("Conversion evidence is invalid");
        }
        const { jobId } = await context.params;
        const result = await deps.recordConversionEvidence({
          jobId,
          actor: {
            userId: access.user.id,
            email: access.user.email ?? "unknown@invalid.local",
          },
          ...parsed.data,
          consentRecordedAt: new Date(parsed.data.consentRecordedAt),
        });
        if (result === "not_found") throw new ProductionJobNotFoundError();
        if (result === "invalid_source") {
          throw new ProductionJobValidationError("Conversion evidence is only available for manual orders");
        }
        if (result === "already_paid") {
          throw new ProductionJobConflictError("Conversion evidence cannot change after payment confirmation");
        }
        return Response.json({ result }, { headers: noStore });
      } catch (error) {
        return errorResponse(error);
      }
    },
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
export const POST = route.POST;
export const PATCH = route.PATCH;
