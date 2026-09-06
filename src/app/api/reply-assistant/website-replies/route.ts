import { requireAdminPermission } from "@/server/auth/require-admin";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { createProductionInbox } from "@/server/rnr-ai/inbox/production-inbox";
import { createWebsiteReplyHandler } from "./route-handler";

const config = parseCustomerServiceConfig();

export const { POST } = createWebsiteReplyHandler({
  enabled: config.websiteEnabled,
  requirePermission: requireAdminPermission,
  answer: (input) => createProductionInbox().answerWebsiteReview(input),
});
