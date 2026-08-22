import { requireAdminPermission } from "@/server/auth/require-admin";
import { customerServiceApiError, noStoreJson } from "@/server/customer-service/api-response";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import type { ReplyAssistantUpdatePage } from "@/server/customer-service/repositories/customer-service-repository";
import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";

type PermissionResult = Readonly<{
  user: Readonly<{ id: string }>;
  adminRole?: "admin" | "staff";
}>;

export function createReplyAssistantUpdatesHandler(dependencies: Readonly<{
  enabled: boolean;
  requirePermission: (permission: "use_reply_assistant") => Promise<PermissionResult>;
  listUpdates: (cursor: string | null) => Promise<ReplyAssistantUpdatePage>;
}>) {
  return {
    async GET(request: Request) {
      try {
        await dependencies.requirePermission("use_reply_assistant");
        if (!dependencies.enabled) return noStoreJson({ error: { code: "FEATURE_DISABLED" } }, 503);
        const cursor = new URL(request.url).searchParams.get("cursor");
        if (cursor !== null && cursor.length > 512) {
          return noStoreJson({ error: { code: "INVALID_CURSOR" } }, 400);
        }
        return noStoreJson(await dependencies.listUpdates(cursor));
      } catch (error) {
        if (error instanceof Error && error.message === "invalid_reply_assistant_cursor") {
          return noStoreJson({ error: { code: "INVALID_CURSOR" } }, 400);
        }
        return customerServiceApiError(error);
      }
    },
  };
}

const config = parseCustomerServiceConfig();
export const { GET } = createReplyAssistantUpdatesHandler({
  enabled: config.enabled || config.websiteEnabled,
  requirePermission: requireAdminPermission,
  listUpdates: (cursor) => createCustomerServiceRuntime().repository.listReplyAssistantUpdates(cursor, 250),
});
