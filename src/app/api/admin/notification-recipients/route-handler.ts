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
  InternalNotificationRecipientValidationError,
} from "@/server/notifications/internal-notification-recipient-service";
import { getInternalNotificationRecipientRuntime } from "@/server/notifications/internal-notification-recipient-runtime";
import {
  INTERNAL_NOTIFICATION_TOPICS,
  type InternalNotificationTopic,
} from "@/server/notifications/internal-notification-types";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
const maximumBodyBytes = 16 * 1024;

class InvalidRecipientJsonError extends Error {}
class MissingAdminEmailError extends Error {}

type Access = Readonly<{ user: Readonly<{ id: string; email?: string }> }>;
type RecipientRuntime = ReturnType<typeof getInternalNotificationRecipientRuntime>;
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<Access>;
  list: RecipientRuntime["list"];
  add: RecipientRuntime["add"];
  trustedOrigin?: string;
}>;

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

function errorResponse(error: unknown, operation: "list" | "save") {
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
  if (error instanceof InternalNotificationRecipientConflictError) {
    return Response.json(
      { error: "Notification recipient already exists" },
      { status: 409, headers: noStore },
    );
  }
  return Response.json(
    {
      error: operation === "list"
        ? "Notification recipients could not be loaded."
        : "The notification recipient could not be saved.",
    },
    { status: 500, headers: noStore },
  );
}

function activeCoverage(recipients: Awaited<ReturnType<RecipientRuntime["list"]>>) {
  const coverage = Object.fromEntries(
    INTERNAL_NOTIFICATION_TOPICS.map((topic) => [topic, 0]),
  ) as Record<InternalNotificationTopic, number>;
  for (const recipient of recipients) {
    if (recipient.status !== "active") continue;
    for (const topic of recipient.topics) coverage[topic] += 1;
  }
  return coverage;
}

export function createAdminNotificationRecipientsRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const recipients = getInternalNotificationRecipientRuntime();
    return {
      requirePermission: requireAdminPermission,
      list: recipients.list,
      add: recipients.add,
    };
  };

  return Object.freeze({
    async GET() {
      const deps = dependencies ?? defaults();
      try {
        await deps.requirePermission("manage_roles");
        const recipients = await deps.list();
        return Response.json(
          { recipients, coverage: activeCoverage(recipients) },
          { headers: noStore },
        );
      } catch (error) {
        return errorResponse(error, "list");
      }
    },

    async POST(request: Request) {
      const deps = dependencies ?? defaults();
      try {
        const access = await deps.requirePermission("manage_roles");
        assertTrustedMutationRequest(request, deps.trustedOrigin);
        const result = await deps.add(actor(access), await parseJsonObject(request));
        return Response.json(result, { status: 201, headers: noStore });
      } catch (error) {
        return errorResponse(error, "save");
      }
    },
  });
}

const route = createAdminNotificationRecipientsRoute();
export const GET = route.GET;
export const POST = route.POST;
