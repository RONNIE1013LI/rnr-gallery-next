import { getAdminUserRuntime } from "@/server/admin/admin-user-runtime";
import { recordAdminFailure } from "@/server/admin/admin-failure-audit";
import {
  AdminUserAuthorizationError,
  AdminUserConflictError,
  AdminUserNotFoundError,
  AdminUserValidationError,
} from "@/server/admin/admin-user-service";
import type { AdminPermission } from "@/server/auth/admin-permissions";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { HttpError } from "@/server/auth/require-session";
import {
  assertTrustedMutationRequest,
  parseBoundedJson,
  MutationRequestError,
} from "@/server/http/mutation-request";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };

type Access = Readonly<{ user: Readonly<{ id: string; email?: string }> }>;
type UserRuntime = ReturnType<typeof getAdminUserRuntime>;
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<Access>;
  updateAccess: UserRuntime["updateAccess"];
  trustedOrigin?: string;
  recordFailure?: typeof recordAdminFailure;
}>;
type Context = Readonly<{ params: Promise<{ userId: string }> }>;

function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof MutationRequestError) {
    return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof AdminUserAuthorizationError) {
    return Response.json({ error: error.message }, { status: 403, headers: noStore });
  }
  if (error instanceof AdminUserValidationError) {
    return Response.json({ error: error.message }, { status: 422, headers: noStore });
  }
  if (error instanceof AdminUserNotFoundError) {
    return Response.json({ error: error.message }, { status: 404, headers: noStore });
  }
  if (error instanceof AdminUserConflictError) {
    return Response.json({ error: error.message }, { status: 409, headers: noStore });
  }
  return Response.json({ error: "The user access could not be updated." }, { status: 500, headers: noStore });
}

function requestSource(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "direct";
}

export function createAdminUserRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => ({
    requirePermission: requireAdminPermission,
    updateAccess: getAdminUserRuntime().updateAccess,
    recordFailure: recordAdminFailure,
  });

  return {
    async PATCH(request: Request, context: Context) {
      const deps = dependencies ?? defaults();
      let actor: Actor | null = null;
      let targetUserId: string | undefined;
      let idempotencyKey: string | undefined;
      try {
        const access = await deps.requirePermission("manage_roles");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        ({ userId: targetUserId } = await context.params);
        actor = {
          userId: access.user.id,
          email: access.user.email ?? "unknown@invalid.local",
        };
        const body = await parseBoundedJson(request) as Record<string, unknown>;
        idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined;
        const result = await deps.updateAccess(actor, {
          targetUserId,
          role: body.role,
          adminPermissions: body.adminPermissions,
          formPermissions: body.formPermissions,
          assignedOnly: body.assignedOnly,
          formPreset: body.formPreset,
          idempotencyKey: body.idempotencyKey,
          requestSource: requestSource(request),
        });
        return Response.json({ result }, { headers: noStore });
      } catch (error) {
        if (actor && deps.recordFailure) {
          await deps.recordFailure({
            actor,
            action: "user.access.change.failed",
            resourceType: "user",
            ...(targetUserId ? { resourceId: targetUserId } : {}),
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

type Actor = Readonly<{ userId: string; email: string }>;

const route = createAdminUserRoute();
export const PATCH = route.PATCH;
