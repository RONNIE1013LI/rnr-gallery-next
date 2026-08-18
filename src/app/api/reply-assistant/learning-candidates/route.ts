export const runtime = "nodejs";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import { createLearningCandidatesHandler } from "./route-handler";

const config = parseCustomerServiceConfig();
export const { GET } = createLearningCandidatesHandler({
  enabled: config.enabled,
  requirePermission: requireAdminPermission,
  list: () => createCustomerServiceRuntime().repository.listLearningCandidates(50),
});
