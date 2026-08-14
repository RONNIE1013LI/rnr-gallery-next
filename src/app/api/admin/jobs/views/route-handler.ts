import { getAdminProductionSavedViewRuntime } from "@/server/admin/admin-production-saved-view-runtime";
import type { AdminPermission, AdminRole } from "@/server/auth/admin-permissions";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { HttpError } from "@/server/auth/require-session";
import { assertTrustedMutationRequest, MutationRequestError, parseBoundedJson } from "@/server/http/mutation-request";
import {
  ProductionSavedViewConflictError,
  ProductionSavedViewValidationError,
} from "@/server/production/production-saved-view-service";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
type Access = Readonly<{ user: Readonly<{ id: string; email?: string }>; adminRole: AdminRole }>;
type SavedRuntime = ReturnType<typeof getAdminProductionSavedViewRuntime>;
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<Access>;
  list: SavedRuntime["list"];
  create: SavedRuntime["create"];
  trustedOrigin?: string;
}>;

function actor(access: Access) {
  return { userId: access.user.id, email: access.user.email ?? "unknown@invalid.local" };
}
function errorResponse(error: unknown) {
  if (error instanceof HttpError || error instanceof MutationRequestError) return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  if (error instanceof ProductionSavedViewConflictError) return Response.json({ error: error.message }, { status: 409, headers: noStore });
  if (error instanceof ProductionSavedViewValidationError) return Response.json({ error: error.message }, { status: 422, headers: noStore });
  return Response.json({ error: "Saved views are unavailable." }, { status: 500, headers: noStore });
}

export function createProductionSavedViewsRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const saved = getAdminProductionSavedViewRuntime();
    return { requirePermission: requireAdminPermission, list: saved.list, create: saved.create };
  };
  return {
    async GET() {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("manage_production_views");
        return Response.json({ views: await deps.list(actor(access)) }, { headers: noStore });
      } catch (error) { return errorResponse(error); }
    },
    async POST(request: Request) {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("manage_production_views");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const result = await deps.create(actor(access), await parseBoundedJson(request));
        return Response.json(result, { status: result.result === "created" ? 201 : 200, headers: noStore });
      } catch (error) { return errorResponse(error); }
    },
  };
}

const route = createProductionSavedViewsRoute();
export const GET = route.GET;
export const POST = route.POST;
