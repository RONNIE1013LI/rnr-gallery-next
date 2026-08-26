import type { PrivateUploadReference } from "@/server/uploads/local-private-upload-store";

const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

type CleanupCandidate = Readonly<{ id: string }>;
type CleanupReference = Pick<PrivateUploadReference, "id" | "storageKey">;

export type PaymentProofRetentionRepository = Readonly<{
  report(cutoff: Date): Promise<{ eligible: number; eligibleBytes: number }>;
  listCandidates(cutoff: Date, limit: number): Promise<readonly CleanupCandidate[]>;
  purge(
    id: string,
    cutoff: Date,
    purgedAt: Date,
    remove: (reference: CleanupReference) => Promise<void>,
  ): Promise<"deleted" | "ineligible">;
}>;

type PaymentProofStore = Readonly<{
  remove(reference: CleanupReference): Promise<void>;
}>;

function assertLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Payment-proof cleanup limit must be between 1 and 100");
  }
}

export function createPaymentProofRetentionCleanup(
  repository: PaymentProofRetentionRepository,
  store: PaymentProofStore,
  options: Readonly<{ retentionMs?: number }> = {},
) {
  const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  if (!Number.isSafeInteger(retentionMs) || retentionMs < 0) {
    throw new Error("Payment-proof retention must be a non-negative integer");
  }

  const cutoffFor = (now: Date) => new Date(now.getTime() - retentionMs);

  return Object.freeze({
    report(now = new Date()) {
      return repository.report(cutoffFor(now));
    },
    run(limit = 100, now = new Date()) {
      assertLimit(limit);
      return (async () => {
        const cutoff = cutoffFor(now);
        const candidates = await repository.listCandidates(cutoff, limit);
        let deleted = 0;
        let skipped = 0;
        let failed = 0;

        for (const candidate of candidates) {
          try {
            const result = await repository.purge(
              candidate.id,
              cutoff,
              now,
              (reference) => store.remove(reference),
            );
            if (result === "deleted") deleted += 1;
            else skipped += 1;
          } catch {
            failed += 1;
          }
        }

        return Object.freeze({
          examined: candidates.length,
          deleted,
          skipped,
          failed,
        });
      })();
    },
  });
}
