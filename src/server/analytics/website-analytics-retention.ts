const RETENTION_MS = 90 * 24 * 60 * 60_000;

type Repository = Readonly<{
  deleteCartSnapshotsBefore?(input: Readonly<{ cutoff: Date; limit: number }>): Promise<number>;
  deleteBefore(input: Readonly<{ cutoff: Date; limit: number }>): Promise<number>;
}>;

export function createWebsiteAnalyticsRetention(repository: Repository) {
  return Object.freeze({
    async run(now = new Date(), requestedLimit = 500) {
      const limit = Math.max(1, Math.min(500, Math.trunc(requestedLimit)));
      const cutoff = new Date(now.getTime() - RETENTION_MS);
      // Separate progress avoids starving cart expiry when retained sessions stay active.
      if (repository.deleteCartSnapshotsBefore) for (let batch = 0; batch < 10; batch += 1) {
        const deleted = await repository.deleteCartSnapshotsBefore({ cutoff, limit });
        if (deleted < limit) break;
      }
      let deletedSessions = 0;
      for (let batch = 0; batch < 10; batch += 1) {
        const deleted = await repository.deleteBefore({ cutoff, limit });
        deletedSessions += deleted;
        if (deleted < limit) break;
      }
      return Object.freeze({ deletedSessions });
    },
  });
}
