import { requireAdminPermission } from "@/server/auth/require-admin";
import { customerServiceApiError, noStoreJson } from "@/server/customer-service/api-response";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import type { PilotMetricCounts } from "@/server/customer-service/repositories/customer-service-repository";
import { calculatePilotMetrics } from "@/server/customer-service/metrics";

export function createMetricsHandler(dependencies: Readonly<{
  enabled: boolean;
  requirePermission: (permission: "use_reply_assistant") => Promise<{ user: { id: string } }>;
  metrics: () => Promise<PilotMetricCounts>;
}>) {
  return { async GET() {
    try {
      await dependencies.requirePermission("use_reply_assistant");
      if (!dependencies.enabled) return noStoreJson({ error: { code: "FEATURE_DISABLED" } }, 503);
      return noStoreJson(calculatePilotMetrics(await dependencies.metrics()));
    } catch (error) {
      return customerServiceApiError(error);
    }
  } };
}

const config = parseCustomerServiceConfig();
export const { GET } = createMetricsHandler({
  enabled: config.enabled,
  requirePermission: requireAdminPermission,
  metrics: () => createCustomerServiceRuntime().repository.metricCounts(),
});
