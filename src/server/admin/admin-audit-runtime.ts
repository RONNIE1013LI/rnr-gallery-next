import { getDatabase } from "@/server/db/client";
import { listAdminAuditLogs } from "./admin-audit-service";

export function getAdminAuditRuntime() {
  const database = getDatabase();
  return Object.freeze({ list: (params: Parameters<typeof listAdminAuditLogs>[1]) => listAdminAuditLogs(database, params) });
}
