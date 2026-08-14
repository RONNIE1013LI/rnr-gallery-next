import { getAdminProductionSavedViewRuntime } from "@/server/admin/admin-production-saved-view-runtime";
import type { AdminPermission, AdminRole } from "@/server/auth/admin-permissions";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { HttpError } from "@/server/auth/require-session";
import { assertTrustedMutationRequest, MutationRequestError } from "@/server/http/mutation-request";
import { ProductionSavedViewValidationError } from "@/server/production/production-saved-view-service";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
type Access = Readonly<{ user: Readonly<{ id: string; email?: string }>; adminRole: AdminRole }>;
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<Access>;
  remove: ReturnType<typeof getAdminProductionSavedViewRuntime>["remove"];
  trustedOrigin?: string;
}>;

export function createProductionSavedViewRoute(dependencies?: Dependencies) {
  return {
    async DELETE(request: Request, context: Readonly<{ params: Promise<{ viewId: string }> }>) {
      try {
        const saved = getAdminProductionSavedViewRuntime();
        const deps = dependencies ?? { requirePermission: requireAdminPermission, remove: saved.remove };
        const access = await deps.requirePermission("manage_production_views");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const { viewId } = await context.params;
        const result = await deps.remove({ userId: access.user.id, email: access.user.email ?? "unknown@invalid.local" }, viewId);
        if (result === "not_found") return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
        return Response.json({ result }, { headers: noStore });
      } catch (error) {
        if (error instanceof HttpError || error instanceof MutationRequestError) return Response.json({ error: error.message }, { status: error.status, headers: noStore });
        if (error instanceof ProductionSavedViewValidationError) return Response.json({ error: error.message }, { status: 422, headers: noStore });
        return Response.json({ error: "The saved view could not be deleted." }, { status: 500, headers: noStore });
      }
    },
  };
}

const route = createProductionSavedViewRoute();
export const DELETE = route.DELETE;
