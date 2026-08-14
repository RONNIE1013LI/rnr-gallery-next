import { getDatabase } from "@/server/db/client";
import { getAdminDashboardSummary } from "./admin-dashboard-service";
import { getProductRegistryRuntime } from "./product-registry-runtime";

export function getAdminDashboardRuntime() {
  const database = getDatabase();
  return Object.freeze({
    summary: async () => {
      const { registry } = await getProductRegistryRuntime().current();
      return getAdminDashboardSummary(database, process.env, registry);
    },
  });
}
