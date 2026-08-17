import { requireAdminPermission } from "@/server/auth/require-admin";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { customerServiceApiError, noStoreJson } from "@/server/customer-service/api-response";
import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import type { SafeQueuePage } from "@/server/customer-service/repositories/customer-service-repository";

export function createMessagesHandler(dependencies: Readonly<{
  enabled: boolean;
  requirePermission: (permission: "use_reply_assistant") => Promise<{ user: { id: string } }>;
  list: () => Promise<SafeQueuePage>;
}>) {
  return {
    async GET() {
      try {
        await dependencies.requirePermission("use_reply_assistant");
        if (!dependencies.enabled) return noStoreJson({ error: { code: "FEATURE_DISABLED" } }, 503);
        return noStoreJson(await dependencies.list());
      } catch (error) {
        return customerServiceApiError(error);
      }
    },
  };
}

const config = parseCustomerServiceConfig();
export const { GET } = createMessagesHandler({
  enabled: config.enabled,
  requirePermission: requireAdminPermission,
  list: () => createCustomerServiceRuntime().repository.listQueue(100),
});
