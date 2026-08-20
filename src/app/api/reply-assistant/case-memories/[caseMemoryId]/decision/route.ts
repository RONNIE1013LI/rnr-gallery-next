export const runtime = "nodejs";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import { createCaseMemoryDecisionHandler } from "./route-handler";

const config = parseCustomerServiceConfig();
export const { POST } = createCaseMemoryDecisionHandler({
  enabled: config.enabled,
  requirePermission: requireAdminPermission,
  decide: (input) => createCustomerServiceRuntime().repository.decideCaseMemory(input),
});
