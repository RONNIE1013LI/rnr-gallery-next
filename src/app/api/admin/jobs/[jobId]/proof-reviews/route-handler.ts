import { getAdminProductionProofRuntime } from "@/server/admin/admin-production-proof-runtime";
import type { AdminPermission, AdminRole } from "@/server/auth/admin-permissions";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { HttpError } from "@/server/auth/require-session";
import { assertTrustedMutationRequest, MutationRequestError, parseBoundedJson } from "@/server/http/mutation-request";
import {
  ProductionProofConflictError,
  ProductionProofNotFoundError,
  ProductionProofValidationError,
} from "@/server/production/production-proof-service";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
type Access = Readonly<{ user: Readonly<{ id: string; email?: string }>; adminRole: AdminRole }>;
type ProofRuntime = ReturnType<typeof getAdminProductionProofRuntime>;
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<Access>;
  recordReview: ProofRuntime["recordReview"];
  trustedOrigin?: string;
}>;
type Context = Readonly<{ params: Promise<{ jobId: string }> }>;

function errorResponse(error: unknown) {
  if (error instanceof HttpError || error instanceof MutationRequestError) return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  if (error instanceof ProductionProofNotFoundError) return Response.json({ error: error.message }, { status: 404, headers: noStore });
  if (error instanceof ProductionProofConflictError) return Response.json({ error: error.message }, { status: 409, headers: noStore });
  if (error instanceof ProductionProofValidationError) return Response.json({ error: error.message }, { status: 422, headers: noStore });
  return Response.json({ error: "The proof decision could not be recorded." }, { status: 500, headers: noStore });
}

export function createProductionProofReviewsRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const proof = getAdminProductionProofRuntime();
    return { requirePermission: requireAdminPermission, recordReview: proof.recordReview };
  };
  return {
    async POST(request: Request, context: Context) {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("review_production_proofs");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const { jobId } = await context.params;
        const body = await parseBoundedJson(request);
        const result = await deps.recordReview({
          userId: access.user.id,
          email: access.user.email ?? "unknown@invalid.local",
        }, jobId, body);
        return Response.json(result, { status: result.result === "created" ? 201 : 200, headers: noStore });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

const route = createProductionProofReviewsRoute();
export const POST = route.POST;
