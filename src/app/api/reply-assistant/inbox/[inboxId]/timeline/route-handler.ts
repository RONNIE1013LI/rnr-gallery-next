import { requireAdminPermission } from "@/server/auth/require-admin";
import { customerServiceApiError, noStoreJson } from "@/server/customer-service/api-response";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import type {
  CustomerServiceRepository,
} from "@/server/customer-service/repositories/customer-service-repository";
import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";

type PermissionResult = Readonly<{
  user: Readonly<{ id: string }>;
  adminRole?: "admin" | "staff";
}>;

type Context = Readonly<{ params: Promise<{ inboxId: string }> }>;

const inboxIdPattern = /^[a-f0-9]{64}$/;
const timelineCursorPattern = /^(?:event|assistant|message):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createReplyAssistantTimelineHandler(dependencies: Readonly<{
  enabled: boolean;
  requirePermission: (permission: "use_reply_assistant") => Promise<PermissionResult>;
  loadTimeline: CustomerServiceRepository["loadEarlierInboxTimeline"];
}>) {
  return {
    async GET(request: Request, context: Context) {
      try {
        await dependencies.requirePermission("use_reply_assistant");
        if (!dependencies.enabled) return noStoreJson({ error: { code: "FEATURE_DISABLED" } }, 503);
        const inboxId = (await context.params).inboxId;
        const cursor = new URL(request.url).searchParams.get("cursor");
        if (!inboxIdPattern.test(inboxId) || !cursor || !timelineCursorPattern.test(cursor)) {
          return noStoreJson({ error: { code: "INVALID_TIMELINE_CURSOR" } }, 400);
        }
        return noStoreJson(await dependencies.loadTimeline({ inboxId, cursor, limit: 50 }));
      } catch (error) {
        if (error instanceof Error && error.message === "reply_assistant_timeline_cursor_invalid") {
          return noStoreJson({ error: { code: "INVALID_TIMELINE_CURSOR" } }, 400);
        }
        if (error instanceof Error && error.message === "reply_assistant_inbox_not_found") {
          return noStoreJson({ error: { code: "INBOX_NOT_FOUND" } }, 404);
        }
        return customerServiceApiError(error);
      }
    },
  };
}

const config = parseCustomerServiceConfig();
export const { GET } = createReplyAssistantTimelineHandler({
  enabled: config.enabled || config.websiteEnabled,
  requirePermission: requireAdminPermission,
  loadTimeline: (input) => createCustomerServiceRuntime().repository.loadEarlierInboxTimeline(input),
});
