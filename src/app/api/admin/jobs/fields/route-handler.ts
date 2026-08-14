import { getAdminProductionFieldRuntime } from "@/server/admin/admin-production-field-runtime";
import type { AdminPermission, AdminRole } from "@/server/auth/admin-permissions";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { HttpError } from "@/server/auth/require-session";
import { assertTrustedMutationRequest, MutationRequestError, parseBoundedJson } from "@/server/http/mutation-request";
import {
  ProductionFieldConflictError,
  ProductionFieldNotFoundError,
  ProductionFieldValidationError,
} from "@/server/production/production-field-service";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
type Access = Readonly<{ user: Readonly<{ id: string; email?: string }>; adminRole: AdminRole }>;
type FieldRuntime = ReturnType<typeof getAdminProductionFieldRuntime>;
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<Access>;
  list: FieldRuntime["list"];
  create: FieldRuntime["create"];
  update: FieldRuntime["update"];
  trustedOrigin?: string;
}>;

function errorResponse(error: unknown) {
  if (error instanceof HttpError || error instanceof MutationRequestError) {
    return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof ProductionFieldValidationError) {
    return Response.json({ error: error.message }, { status: 422, headers: noStore });
  }
  if (error instanceof ProductionFieldNotFoundError) {
    return Response.json({ error: error.message }, { status: 404, headers: noStore });
  }
  if (error instanceof ProductionFieldConflictError) {
    return Response.json({ error: error.message }, { status: 409, headers: noStore });
  }
  return Response.json({ error: "Production fields could not be updated." }, { status: 500, headers: noStore });
}

function actor(access: Access) {
  return { userId: access.user.id, email: access.user.email ?? "unknown@invalid.local" };
}

export function createAdminProductionFieldsRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const fields = getAdminProductionFieldRuntime();
    return { requirePermission: requireAdminPermission, list: fields.list, create: fields.create, update: fields.update };
  };
  return {
    async GET() {
      const deps = dependencies ?? defaults();
      try {
        await deps.requirePermission("manage_production_fields");
        return Response.json({ fields: await deps.list() }, { headers: noStore });
      } catch (error) {
        return errorResponse(error);
      }
    },
    async POST(request: Request) {
      const deps = dependencies ?? defaults();
      try {
        const access = await deps.requirePermission("manage_production_fields");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const field = await deps.create(actor(access), await parseBoundedJson(request));
        return Response.json({ field }, { status: 201, headers: noStore });
      } catch (error) {
        return errorResponse(error);
      }
    },
    async PATCH(request: Request) {
      const deps = dependencies ?? defaults();
      try {
        const access = await deps.requirePermission("manage_production_fields");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const result = await deps.update(actor(access), await parseBoundedJson(request));
        return Response.json({ result }, { headers: noStore });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

const route = createAdminProductionFieldsRoute();
export const GET = route.GET;
export const POST = route.POST;
export const PATCH = route.PATCH;
