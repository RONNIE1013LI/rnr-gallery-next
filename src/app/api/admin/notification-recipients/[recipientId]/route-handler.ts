import type { AdminPermission } from "@/server/auth/admin-permissions";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { HttpError } from "@/server/auth/require-session";
import {
  assertTrustedMutationRequest,
  MutationRequestError,
  parseBoundedJson,
} from "@/server/http/mutation-request";
import {
  InternalNotificationRecipientConflictError,
  InternalNotificationRecipientNotFoundError,
  InternalNotificationRecipientValidationError,
} from "@/server/notifications/internal-notification-recipient-service";
import { getInternalNotificationRecipientRuntime } from "@/server/notifications/internal-notification-recipient-runtime";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
const maximumBodyBytes = 16 * 1024;

class InvalidRecipientJsonError extends Error {}
class MissingAdminEmailError extends Error {}

type Access = Readonly<{ user: Readonly<{ id: string; email?: string }> }>;
type RecipientRuntime = ReturnType<typeof getInternalNotificationRecipientRuntime>;
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<Access>;
  updateSubscriptions: RecipientRuntime["updateSubscriptions"];
  disable: RecipientRuntime["disable"];
  trustedOrigin?: string;
}>;
type Context = Readonly<{ params: Promise<{ recipientId: string }> }>;

function actor(access: Access) {
  if (!access.user.email) throw new MissingAdminEmailError();
  return Object.freeze({ userId: access.user.id, email: access.user.email });
}

async function parseJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await parseBoundedJson(request, maximumBodyBytes);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new InvalidRecipientJsonError();
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (
      error instanceof InvalidRecipientJsonError ||
      error instanceof SyntaxError ||
      error instanceof TypeError
    ) {
      throw new InvalidRecipientJsonError();
    }
    throw error;
  }
}

function errorResponse(error: unknown, operation: "updated" | "disabled") {
  if (error instanceof HttpError || error instanceof MutationRequestError) {
    return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof InvalidRecipientJsonError) {
    return Response.json(
      { error: "Request body must contain valid JSON." },
      { status: 400, headers: noStore },
    );
  }
  if (error instanceof InternalNotificationRecipientValidationError) {
    return Response.json(
      { error: "Invalid notification recipient input" },
      { status: 422, headers: noStore },
    );
  }
  if (error instanceof InternalNotificationRecipientNotFoundError) {
    return Response.json(
      { error: "Notification recipient not found" },
      { status: 404, headers: noStore },
    );
  }
  if (error instanceof InternalNotificationRecipientConflictError) {
    return Response.json(
      { error: "The notification recipient changed. Refresh and try again." },
      { status: 409, headers: noStore },
    );
  }
  return Response.json(
    {
      error: operation === "updated"
        ? "The notification recipient could not be updated."
        : "The notification recipient could not be disabled.",
    },
    { status: 500, headers: noStore },
  );
}

export function createAdminNotificationRecipientRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const recipients = getInternalNotificationRecipientRuntime();
    return {
      requirePermission: requireAdminPermission,
      updateSubscriptions: recipients.updateSubscriptions,
      disable: recipients.disable,
    };
  };

  return Object.freeze({
    async PATCH(request: Request, context: Context) {
      const deps = dependencies ?? defaults();
      try {
        const access = await deps.requirePermission("manage_roles");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const [{ recipientId }, body] = await Promise.all([
          context.params,
          parseJsonObject(request),
        ]);
        const recipient = await deps.updateSubscriptions(actor(access), {
          ...body,
          recipientId,
        });
        return Response.json({ recipient }, { headers: noStore });
      } catch (error) {
        return errorResponse(error, "updated");
      }
    },

    async DELETE(request: Request, context: Context) {
      const deps = dependencies ?? defaults();
      try {
        const access = await deps.requirePermission("manage_roles");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const [{ recipientId }, body] = await Promise.all([
          context.params,
          parseJsonObject(request),
        ]);
        const recipient = await deps.disable(actor(access), {
          ...body,
          recipientId,
        });
        return Response.json({ recipient }, { headers: noStore });
      } catch (error) {
        return errorResponse(error, "disabled");
      }
    },
  });
}

const route = createAdminNotificationRecipientRoute();
export const PATCH = route.PATCH;
export const DELETE = route.DELETE;
