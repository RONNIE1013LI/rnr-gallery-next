import { getDatabase } from "@/server/db/client";
import { getSafePublicContent } from "@/server/admin/admin-content-runtime";
import {
  createDrizzleManualConversionCandidateReader,
  createManualConversionCandidateService,
} from "@/server/analytics/manual-order-candidate-service";
import {
  createDrizzleManualConversionSuccessStore,
  createManualConversionDispatcher,
  createManualConversionObserver,
  manualOfflineConversionsEnabled,
} from "@/server/analytics/manual-conversion-dispatcher";
import { createMetaCapiClient } from "@/server/analytics/meta-capi-client";
import {
  createDrizzleProductionJobRepository,
  getProductionJobDetail,
  listProductionAssignees,
  listProductionJobs,
} from "@/server/production/drizzle-production-job-repository";
import { createProductionJobService } from "@/server/production/production-job-service";
import { allocateOrderNumber } from "@/server/orders/order-number";

export function getAdminProductionRuntime(options: Readonly<{
  scheduleAfter?: (task: () => Promise<void>) => void;
}> = {}) {
  const database = getDatabase();
  const repository = createDrizzleProductionJobRepository(database);
  const candidates = createManualConversionCandidateService(
    createDrizzleManualConversionCandidateReader(database),
  );
  const metaAccessToken = process.env.META_CAPI_ACCESS_TOKEN?.trim();
  const meta = createMetaCapiClient({ accessToken: metaAccessToken });
  const conversions = createManualConversionDispatcher({
    listCandidates: candidates.list,
    successStore: createDrizzleManualConversionSuccessStore(database),
    metaSend: async (event) => Boolean(metaAccessToken)
      && (await getSafePublicContent(["advertising.meta.enabled"]))
        ["advertising.meta.enabled"] === "enabled"
      ? meta.send(event)
      : "disabled",
  });
  const service = createProductionJobService(
    repository,
    {
      createJobNumber: () => allocateOrderNumber(database),
      ...(options.scheduleAfter && manualOfflineConversionsEnabled() ? {
        onManualPaid: createManualConversionObserver(
          options.scheduleAfter,
          conversions.dispatch,
        ),
      } : {}),
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
    deleteManual: (
      actor: Readonly<{ userId: string; email: string }>,
      jobId: string,
      input: Readonly<{ expectedJobNumber: string; idempotencyKey: string }>,
    ) => repository.deleteManual({ actor, jobId, ...input }),
  });
}
