import { getAdminOrderRuntime } from "@/server/admin/admin-order-runtime";
import { recordAdminFailure } from "@/server/admin/admin-failure-audit";
import {
  AdminOrderConflictError,
  AdminOrderNotFoundError,
  AdminOrderValidationError,
} from "@/server/admin/order-admin-service";
import { requireAdminPermission } from "@/server/auth/require-admin";
import type { AdminPermission } from "@/server/auth/admin-permissions";
import { HttpError } from "@/server/auth/require-session";
import {
  assertTrustedMutationRequest,
  parseBoundedJson,
  MutationRequestError,
} from "@/server/http/mutation-request";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };

type ActorAccess = Readonly<{
  user: Readonly<{ id: string; email?: string }>;
}>;

type MutationMethods = ReturnType<typeof getAdminOrderRuntime>["mutations"];

type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<ActorAccess>;
  mutations: MutationMethods;
  trustedOrigin?: string;
  recordFailure?: typeof recordAdminFailure;
}>;

type Context = Readonly<{ params: Promise<{ orderId: string }> }>;

function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof MutationRequestError) {
    return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof AdminOrderValidationError) {
    return Response.json({ error: error.message }, { status: 422, headers: noStore });
  }
  if (error instanceof AdminOrderNotFoundError) {
    return Response.json({ error: error.message }, { status: 404, headers: noStore });
  }
  if (error instanceof AdminOrderConflictError) {
    return Response.json({ error: error.message }, { status: 409, headers: noStore });
  }
  return Response.json({ error: "The order could not be updated." }, { status: 500, headers: noStore });
}

function requestSource(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "direct";
}

export function createAdminOrderRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => ({
    requirePermission: requireAdminPermission,
    mutations: getAdminOrderRuntime().mutations,
    recordFailure: recordAdminFailure,
  });

  return {
    async PATCH(request: Request, context: Context) {
      const deps = dependencies ?? defaults();
      let actor: Readonly<{ userId: string; email: string }> | null = null;
      let action = "order.mutation.failed";
      let orderId: string | undefined;
      let idempotencyKey: string | undefined;
      try {
        const access = await deps.requirePermission("update_order_status");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const body = await parseBoundedJson(request) as Record<string, unknown>;
        ({ orderId } = await context.params);
        actor = {
          userId: access.user.id,
          email: access.user.email ?? "unknown@invalid.local",
        };
        idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined;
        action = body.action === "change_status" ? "order.status.change.failed"
          : body.action === "add_note" ? "order.note.add.failed"
            : body.action === "set_tracking" ? "order.tracking.change.failed"
              : "order.mutation.failed";
        const common = {
          orderId,
          idempotencyKey: body.idempotencyKey,
          requestSource: requestSource(request),
        };

        let result: unknown;
        if (body.action === "change_status") {
          if (body.toStatus === "cancelled" && body.confirmed !== true) {
            throw new AdminOrderValidationError("Cancellation must be confirmed");
          }
          result = await deps.mutations.changeStatus(actor, {
            ...common,
            toStatus: body.toStatus,
            reason: body.reason,
          });
        } else if (body.action === "add_note") {
          result = await deps.mutations.addNote(actor, {
            ...common,
            visibility: body.visibility,
            body: body.body,
          });
        } else if (body.action === "set_tracking") {
          result = await deps.mutations.setTracking(actor, {
            ...common,
            carrier: body.carrier,
            trackingNumber: body.trackingNumber,
            trackingUrl: body.trackingUrl,
          });
        } else {
          throw new AdminOrderValidationError("Unknown order action");
        }
        return Response.json({ result }, { headers: noStore });
      } catch (error) {
        if (actor && deps.recordFailure) {
          await deps.recordFailure({ actor, action, resourceType: "order", ...(orderId ? { resourceId: orderId } : {}), requestSource: requestSource(request), ...(idempotencyKey ? { idempotencyKey } : {}), error });
        }
        return errorResponse(error);
      }
    },
  };
}

const route = createAdminOrderRoute();
export const PATCH = route.PATCH;
