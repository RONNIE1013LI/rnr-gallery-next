import { getDatabase } from "@/server/db/client";
import {
  createDrizzleProductionJobRepository,
  getProductionJobDetail,
  listProductionAssignees,
  listProductionJobs,
  recordManualConversionEvidence,
} from "@/server/production/drizzle-production-job-repository";
import { createProductionJobService } from "@/server/production/production-job-service";
import { allocateOrderNumber } from "@/server/orders/order-number";
import type { NotificationDeliveryTrigger } from "@/server/notifications/immediate-notification-delivery";

export function getAdminProductionRuntime(
  onNotificationOutboxAvailable?: NotificationDeliveryTrigger,
) {
  const database = getDatabase();
  const repository = createDrizzleProductionJobRepository(database);
  const service = createProductionJobService(
    repository,
    {
      createJobNumber: () => allocateOrderNumber(database),
      onNotificationOutboxAvailable,
    },
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
    recordConversionEvidence: (
      input: Parameters<typeof recordManualConversionEvidence>[1],
    ) => recordManualConversionEvidence(database, input),
    deleteManual: (
      actor: Readonly<{ userId: string; email: string }>,
      jobId: string,
      input: Readonly<{ expectedJobNumber: string; idempotencyKey: string }>,
    ) => repository.deleteManual({ actor, jobId, ...input }),
  });
}
