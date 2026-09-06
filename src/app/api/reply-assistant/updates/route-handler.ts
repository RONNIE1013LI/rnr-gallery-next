import { requireAdminPermission } from "@/server/auth/require-admin";
import { customerServiceApiError, noStoreJson } from "@/server/customer-service/api-response";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import type { ReplyAssistantUpdatePage } from "@/server/customer-service/repositories/customer-service-repository";
import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import { createProductionInbox } from "@/server/rnr-ai/inbox/production-inbox";

type PermissionResult = Readonly<{
  user: Readonly<{ id: string }>;
  adminRole?: "admin" | "staff";
}>;

export function createReplyAssistantUpdatesHandler(dependencies: Readonly<{
  enabled: boolean;
  requirePermission: (permission: "use_reply_assistant") => Promise<PermissionResult>;
  initialHistory?: () => Promise<ReplyAssistantUpdatePage>;
  listUpdates: (cursor: string | null) => Promise<ReplyAssistantUpdatePage>;
}>) {
  return {
    async GET(request: Request) {
      try {
        await dependencies.requirePermission("use_reply_assistant");
        if (!dependencies.enabled) return noStoreJson({ error: { code: "FEATURE_DISABLED" } }, 503);
        const params = new URL(request.url).searchParams;
        const section = params.get("section");
        if (section !== null && section !== "history") return noStoreJson({ error: { code: "INVALID_SECTION" } }, 400);
        if (section === "history") {
          if (!dependencies.initialHistory) return noStoreJson({ error: { code: "FEATURE_DISABLED" } }, 503);
          return noStoreJson(await dependencies.initialHistory());
        }
        const cursor = params.get("cursor");
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
  initialHistory: async () => {
    const repository = createCustomerServiceRuntime().repository;
    // Capture the cursor first so a concurrent update can still be observed later.
    const cursor = await repository.getReplyAssistantUiCursor();
    const [metrics, learningCandidates, caseMemories] = await Promise.all([
      repository.metricCounts(), repository.listLearningCandidates(20), repository.listCaseMemoryCandidates(20),
    ]);
    return { cursor, hasMore: false, queueItems: [], metrics, learningCandidates, caseMemories };
  },
  listUpdates: (cursor) => createProductionInbox().listReplyAssistantUpdates(cursor, 250),
});
