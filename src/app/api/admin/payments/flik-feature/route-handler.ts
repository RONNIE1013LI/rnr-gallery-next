import { z } from "zod";
import { requireAdminPermission } from "@/server/auth/require-admin";
import type { AdminPermission } from "@/server/auth/admin-permissions";
import { HttpError } from "@/server/auth/require-session";
import { assertTrustedMutationRequest, MutationRequestError, parseBoundedJson } from "@/server/http/mutation-request";
import { createFlikFeatureService, FlikFeatureAccessError } from "@/server/payments/flik-feature";
import { FlikFeatureConflictError, FlikFeatureValidationError } from "@/server/payments/flik-feature-repository";

const headers = { "Cache-Control": "no-store" };
const status = z.enum(["disabled", "internal_verification", "live"]);
const changeSchema = z.object({ status, expectedStatus: status, idempotencyKey: z.uuid(), liveVerificationConfirmed: z.boolean().optional() }).strict();
type Dependencies = {
  requirePermission: (permission: AdminPermission) => Promise<{ user: { id: string; email?: string }; adminRole: "admin" | "staff" }>;
  service: () => Promise<ReturnType<typeof createFlikFeatureService>>;
  trustedOrigin?: string;
};
function defaults(): Dependencies {
  return {
    requirePermission: requireAdminPermission,
    async service() {
      const [{ getDatabase }, { createDrizzleFlikFeatureRepository }] = await Promise.all([
        import("@/server/db/client"), import("@/server/payments/flik-feature-repository"),
      ]);
      return createFlikFeatureService({ repository: createDrizzleFlikFeatureRepository(getDatabase()) });
    },
  };
}
function errorResponse(error: unknown) {
  if (error instanceof HttpError || error instanceof MutationRequestError || error instanceof FlikFeatureAccessError) return Response.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof FlikFeatureValidationError) return Response.json({ error: "Invalid Flik availability request" }, { status: 400, headers });
  if (error instanceof FlikFeatureConflictError) return Response.json({ error: "Flik availability changed. Refresh its status before trying again." }, { status: 409, headers });
  return Response.json({ error: "Flik availability is unavailable. No enabling change was confirmed." }, { status: 503, headers });
}
export function createAdminFlikFeatureRoute(dependencies?: Dependencies) {
  return {
    async GET() {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("manage_payment");
        return Response.json(await (await deps.service()).getSnapshot(access.adminRole === "admin"), { headers });
      } catch (error) { return errorResponse(error); }
    },
    async POST(request: Request) {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("manage_payment");
        if (access.adminRole !== "admin") throw new HttpError("Only the owner can change Flik availability", 403);
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const input = changeSchema.parse(await parseBoundedJson(request, 4096));
        return Response.json(await (await deps.service()).transition(input, { userId: access.user.id, email: access.user.email ?? "", role: access.adminRole }), { headers });
      } catch (error) { return errorResponse(error); }
    },
  };
}
const route = createAdminFlikFeatureRoute();
export const GET = route.GET;
export const POST = route.POST;
