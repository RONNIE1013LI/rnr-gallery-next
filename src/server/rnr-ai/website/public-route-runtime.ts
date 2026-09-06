import { parseRnrAiMetaConfig } from "../meta/config";
import { createProductionWebsiteReplyRuntime } from "./website-runtime";
import { getWebsiteChatIdentitySession } from "./chat-auth";
import { resolveLocalChatProductContext } from "@/server/customer-service/website/product-context";

export async function createWebsitePublicRouteRuntime() {
  // This explicit rollout switch owns storage. Master AI OFF never falls back to Neon.
  if (parseRnrAiMetaConfig().websiteSharedBrainEnabled) {
    const runtime = createProductionWebsiteReplyRuntime();
    const deadlineAt = Date.now() + 50_000;
    return {
      repository: runtime.repository,
      websiteGenerationMode: "shared_brain" as const,
      getOptionalSession: getWebsiteChatIdentitySession,
      resolveProductContext: resolveLocalChatProductContext,
      processWebsiteTurn: runtime.processTurn,
      processReviewAlert: () => runtime.recoverReviewAlerts(1, deadlineAt),
      processCustomerNotifications: undefined,
    };
  }
  const { createCustomerServiceRuntime } = await import("@/server/customer-service/runtime");
  const { getOptionalSession } = await import("@/server/auth/get-optional-session");
  const { resolveCurrentSafeProductContext } = await import("@/server/customer-service/website/product-context");
  const runtime = createCustomerServiceRuntime();
  return {
    repository: runtime.repository,
    websiteGenerationMode: runtime.websiteGenerationMode,
    getOptionalSession,
    resolveProductContext: resolveCurrentSafeProductContext,
    processWebsiteTurn: (turnId: string, mode: "legacy" | "shared_brain") => runtime.processWebsiteTurn(turnId, mode),
    processReviewAlert: () => runtime.reviewAlertService?.deliverNext() ?? Promise.resolve({ result: "not_configured" }),
    processCustomerNotifications: async () => {
      const { getAllCustomerNotificationRuntime } = await import("@/server/notifications/customer-notification-runtime");
      return getAllCustomerNotificationRuntime().deliverPending(20);
    },
  };
}
