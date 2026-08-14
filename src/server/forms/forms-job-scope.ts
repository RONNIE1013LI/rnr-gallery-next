import { getAdminProductionRuntime } from "@/server/admin/admin-production-runtime";
import { ProductionJobNotFoundError } from "@/server/production/production-job-service";

type ScopeAccess = Readonly<{
  user: Readonly<{ id: string }>;
  formProfile: Readonly<{ assignedOnly: boolean }> | null;
}>;

type FindAssignment = (jobId: string) => Promise<string | null | undefined>;

async function findAssignment(jobId: string) {
  const detail = await getAdminProductionRuntime().detail(jobId, { canViewFinance: false });
  return detail?.job.assignedUserId;
}

export async function assertFormsJobScope(
  access: ScopeAccess,
  jobId: string,
  lookup: FindAssignment = findAssignment,
) {
  if (!access.formProfile?.assignedOnly) return;
  if (await lookup(jobId) !== access.user.id) throw new ProductionJobNotFoundError();
}
