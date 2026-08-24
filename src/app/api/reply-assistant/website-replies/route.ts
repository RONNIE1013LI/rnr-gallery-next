import { requireAdminPermission } from "@/server/auth/require-admin";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import { createWebsiteReplyHandler } from "./route-handler";

const config = parseCustomerServiceConfig();

export const { POST } = createWebsiteReplyHandler({
  enabled: config.websiteEnabled,
  requirePermission: requireAdminPermission,
  answer: (input) => createCustomerServiceRuntime().repository.answerWebsiteReview(input),
});
