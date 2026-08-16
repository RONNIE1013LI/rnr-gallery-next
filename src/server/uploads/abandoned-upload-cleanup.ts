type CleanupCandidate = Readonly<{ id: string }>;
type ClaimedUpload = Readonly<{ id: string; storageKey: string; bound: boolean }>;

export type AbandonedUploadCleanupRepository = Readonly<{
  report(before: Date): Promise<{ eligible: number; eligibleBytes: number }>;
  listCandidates(before: Date, limit: number): Promise<readonly CleanupCandidate[]>;
  claim(id: string, before: Date, claimedAt: Date): Promise<ClaimedUpload | null>;
  complete(
    id: string,
    claimedAt: Date,
    purgedAt: Date,
  ): Promise<"deleted" | "tombstoned" | null>;
  release(id: string, claimedAt: Date): Promise<boolean>;
  deleteExpiredEmptySessions(before: Date): Promise<number>;
}>;

type UploadStore = Readonly<{
  remove(reference: ClaimedUpload): Promise<void>;
}>;

export function createAbandonedUploadCleanup(
  repository: AbandonedUploadCleanupRepository,
  store: UploadStore,
  options: Readonly<{ retentionMs?: number }> = {},
) {
  const retentionMs = options.retentionMs ?? 5 * 24 * 60 * 60 * 1_000;
  if (!Number.isSafeInteger(retentionMs) || retentionMs < 0) {
    throw new Error("Upload cleanup retention must be a non-negative integer");
  }

  return Object.freeze({
    async report(now = new Date()) {
      const before = new Date(now.getTime() - retentionMs);
      return repository.report(before);
    },

    async run(limit = 100, now = new Date()) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new Error("Upload cleanup limit must be between 1 and 100");
      }
      const before = new Date(now.getTime() - retentionMs);
      const candidates = await repository.listCandidates(before, limit);
      let removed = 0;
      let tombstoned = 0;
      let failed = 0;

      for (const candidate of candidates) {
        const claimed = await repository.claim(candidate.id, before, now);
        if (!claimed) continue;
        try {
          await store.remove(claimed);
          const result = await repository.complete(claimed.id, now, now);
          if (result) {
            removed += 1;
            if (result === "tombstoned") tombstoned += 1;
          } else failed += 1;
        } catch {
          failed += 1;
          await repository.release(claimed.id, now).catch(() => false);
        }
      }

      const sessionsDeleted = await repository.deleteExpiredEmptySessions(before);
      return Object.freeze({
        examined: candidates.length,
        removed,
        tombstoned,
        failed,
        sessionsDeleted,
      });
    },
  });
}
