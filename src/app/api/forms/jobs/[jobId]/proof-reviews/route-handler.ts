import { getAdminProductionProofRuntime } from "@/server/admin/admin-production-proof-runtime";
import { HttpError } from "@/server/auth/require-session";
import { assertFormsJobScope } from "@/server/forms/forms-job-scope";
import type { FormPermission } from "@/server/forms/forms-permissions";
import { requireFormPermission, type FormAccess } from "@/server/forms/require-forms";
import { assertTrustedMutationRequest, MutationRequestError, parseBoundedJson } from "@/server/http/mutation-request";
import { ProductionJobNotFoundError } from "@/server/production/production-job-service";
import { ProductionProofConflictError, ProductionProofNotFoundError, ProductionProofValidationError } from "@/server/production/production-proof-service";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
type Access = FormAccess<Readonly<{ user: Readonly<{ id: string; email?: string }> }>>;
type ProofRuntime = ReturnType<typeof getAdminProductionProofRuntime>;
type Dependencies = Readonly<{
  requirePermission: (permission: FormPermission) => Promise<Access>;
  assertScope: typeof assertFormsJobScope;
  recordReview: ProofRuntime["recordReview"];
  trustedOrigin?: string;
}>;
type Context = Readonly<{ params: Promise<{ jobId: string }> }>;

function errorResponse(error: unknown) {
  if (error instanceof HttpError || error instanceof MutationRequestError) return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  if (error instanceof ProductionProofNotFoundError || error instanceof ProductionJobNotFoundError) return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
  if (error instanceof ProductionProofConflictError) return Response.json({ error: error.message }, { status: 409, headers: noStore });
  if (error instanceof ProductionProofValidationError) return Response.json({ error: error.message }, { status: 422, headers: noStore });
  return Response.json({ error: "The proof decision could not be recorded." }, { status: 500, headers: noStore });
}

export function createFormsProofReviewsRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => ({
    requirePermission: requireFormPermission,
    assertScope: assertFormsJobScope,
    recordReview: getAdminProductionProofRuntime().recordReview,
  });
  return {
    async POST(request: Request, context: Context) {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("update_production_status");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const { jobId } = await context.params;
        await deps.assertScope(access, jobId);
        const result = await deps.recordReview(
          { userId: access.user.id, email: access.user.email ?? "unknown@invalid.local" },
          jobId,
          await parseBoundedJson(request),
        );
        return Response.json(result, { status: result.result === "created" ? 201 : 200, headers: noStore });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

const route = createFormsProofReviewsRoute();
export const POST = route.POST;
