type CleanupCandidate = Readonly<{ id: string }>;
type ClaimedUpload = Readonly<{ id: string; storageKey: string }>;

export type AbandonedUploadCleanupRepository = Readonly<{
  listCandidates(before: Date, limit: number): Promise<readonly CleanupCandidate[]>;
  claim(id: string, before: Date, claimedAt: Date): Promise<ClaimedUpload | null>;
  complete(id: string, claimedAt: Date): Promise<boolean>;
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
  const retentionMs = options.retentionMs ?? 24 * 60 * 60 * 1_000;
  if (!Number.isSafeInteger(retentionMs) || retentionMs < 0) {
    throw new Error("Upload cleanup retention must be a non-negative integer");
  }

  return Object.freeze({
    async run(limit = 50, now = new Date()) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new Error("Upload cleanup limit must be between 1 and 100");
      }
      const before = new Date(now.getTime() - retentionMs);
      const candidates = await repository.listCandidates(before, limit);
      let removed = 0;
      let failed = 0;

      for (const candidate of candidates) {
        const claimed = await repository.claim(candidate.id, before, now);
        if (!claimed) continue;
        try {
          await store.remove(claimed);
          if (await repository.complete(claimed.id, now)) removed += 1;
          else failed += 1;
        } catch {
          failed += 1;
          await repository.release(claimed.id, now).catch(() => false);
        }
      }

      const sessionsDeleted = await repository.deleteExpiredEmptySessions(before);
      return Object.freeze({
        examined: candidates.length,
        removed,
        failed,
        sessionsDeleted,
      });
    },
  });
}
