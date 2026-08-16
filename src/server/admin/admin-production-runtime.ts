import { getDatabase } from "@/server/db/client";
import {
  createDrizzleProductionJobRepository,
  getProductionJobDetail,
  listProductionAssignees,
  listProductionJobs,
} from "@/server/production/drizzle-production-job-repository";
import { createProductionJobService } from "@/server/production/production-job-service";
import { allocateOrderNumber } from "@/server/orders/order-number";

export function getAdminProductionRuntime() {
  const database = getDatabase();
  const service = createProductionJobService(
    createDrizzleProductionJobRepository(database),
    { createJobNumber: () => allocateOrderNumber(database) },
  );
  return Object.freeze({
    list: (
      filters: Parameters<typeof listProductionJobs>[1],
      permissions: Parameters<typeof listProductionJobs>[2],
    ) => listProductionJobs(database, filters, permissions),
    detail: (
      jobId: string,
      permissions: Parameters<typeof getProductionJobDetail>[2],
    ) => getProductionJobDetail(database, jobId, permissions),
    assignees: () => listProductionAssignees(database),
    createManual: service.createManual,
    update: service.update,
  });
}
