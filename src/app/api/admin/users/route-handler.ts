import { getAdminUserRuntime } from "@/server/admin/admin-user-runtime";
import {
  AdminEmployeeAuthorizationError,
  AdminEmployeeConflictError,
  AdminEmployeeValidationError,
} from "@/server/admin/admin-employee-service";
import type { AdminPermission } from "@/server/auth/admin-permissions";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { HttpError } from "@/server/auth/require-session";
import {
  assertTrustedMutationRequest,
  MutationRequestError,
  parseBoundedJson,
} from "@/server/http/mutation-request";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };

type Access = Readonly<{ user: Readonly<{ id: string; email?: string }> }>;
type UserRuntime = ReturnType<typeof getAdminUserRuntime>;
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<Access>;
  createEmployee: UserRuntime["createEmployee"];
  trustedOrigin?: string;
}>;

function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof MutationRequestError) {
    return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof SyntaxError) {
    return Response.json({ error: "Request body must contain valid JSON." }, { status: 400, headers: noStore });
  }
  if (error instanceof AdminEmployeeAuthorizationError) {
    return Response.json({ error: error.message }, { status: 403, headers: noStore });
  }
  if (error instanceof AdminEmployeeValidationError) {
    return Response.json({ error: error.message }, { status: 422, headers: noStore });
  }
  if (error instanceof AdminEmployeeConflictError) {
    return Response.json({ error: error.message }, { status: 409, headers: noStore });
  }
  return Response.json({ error: "The employee account could not be created." }, { status: 500, headers: noStore });
}

function requestSource(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "direct";
}

export function createAdminEmployeeRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => ({
    requirePermission: requireAdminPermission,
    createEmployee: getAdminUserRuntime().createEmployee,
  });

  return {
    async POST(request: Request) {
      try {
        const deps = dependencies ?? defaults();
        const access = await deps.requirePermission("manage_roles");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const body = await parseBoundedJson(request) as Record<string, unknown>;
        const result = await deps.createEmployee({
          userId: access.user.id,
          email: access.user.email ?? "unknown@invalid.local",
        }, {
          ...body,
          requestSource: requestSource(request),
        });
        return Response.json({ result }, { status: 201, headers: noStore });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

const route = createAdminEmployeeRoute();
export const POST = route.POST;
