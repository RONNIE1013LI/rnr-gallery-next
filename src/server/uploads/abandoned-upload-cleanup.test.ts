import { describe, expect, it, vi } from "vitest";
import { createAbandonedUploadCleanup } from "./abandoned-upload-cleanup";

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1_000;

function createRepository() {
  return {
    report: vi.fn().mockResolvedValue({ eligible: 2, eligibleBytes: 12_345 }),
    listCandidates: vi.fn().mockResolvedValue([{ id: "one" }, { id: "two" }]),
    claim: vi.fn()
      .mockResolvedValueOnce({ id: "one", storageKey: "one.bin", bound: true })
      .mockResolvedValueOnce({ id: "two", storageKey: "two.bin", bound: false }),
    complete: vi.fn()
      .mockResolvedValueOnce("tombstoned")
      .mockResolvedValueOnce("deleted"),
    release: vi.fn().mockResolvedValue(true),
    deleteExpiredEmptySessions: vi.fn().mockResolvedValue(3),
  };
}

describe("checkout source-photo cleanup", () => {
  it("reports five-day eligibility without mutating uploads or storage", async () => {
    const repository = createRepository();
    const store = { remove: vi.fn() };
    const cleanup = createAbandonedUploadCleanup(repository, store);
    const now = new Date("2026-08-06T00:00:00Z");

    await expect(cleanup.report(now)).resolves.toEqual({
      eligible: 2,
      eligibleBytes: 12_345,
    });
    expect(repository.report).toHaveBeenCalledWith(
      new Date(now.getTime() - FIVE_DAYS_MS),
    );
    expect(repository.listCandidates).not.toHaveBeenCalled();
    expect(repository.claim).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.release).not.toHaveBeenCalled();
    expect(repository.deleteExpiredEmptySessions).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
  });

  it("removes bound and unbound binaries and retains only the bound tombstone", async () => {
    const repository = createRepository();
    const store = { remove: vi.fn().mockResolvedValue(undefined) };
    const cleanup = createAbandonedUploadCleanup(repository, store);
    const now = new Date("2026-08-06T00:00:00Z");

    await expect(cleanup.run(undefined, now)).resolves.toEqual({
      examined: 2,
      removed: 2,
      tombstoned: 1,
      failed: 0,
      sessionsDeleted: 3,
    });
    expect(repository.listCandidates).toHaveBeenCalledWith(
      new Date(now.getTime() - FIVE_DAYS_MS),
      100,
    );
    expect(repository.complete).toHaveBeenNthCalledWith(1, "one", now, now);
    expect(repository.complete).toHaveBeenNthCalledWith(2, "two", now, now);
  });

  it("releases a claim when private storage removal fails", async () => {
    const repository = createRepository();
    repository.listCandidates.mockResolvedValue([{ id: "one" }]);
    repository.claim.mockReset().mockResolvedValue({
      id: "one",
      storageKey: "one.bin",
      bound: true,
    });
    const store = {
      remove: vi.fn().mockRejectedValue(new Error("temporary disk failure")),
    };
    const cleanup = createAbandonedUploadCleanup(repository, store);
    const now = new Date("2026-08-06T00:00:00Z");

    await expect(cleanup.run(50, now)).resolves.toEqual({
      examined: 1,
      removed: 0,
      tombstoned: 0,
      failed: 1,
      sessionsDeleted: 3,
    });
    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.release).toHaveBeenCalledWith("one", now);
  });
});
