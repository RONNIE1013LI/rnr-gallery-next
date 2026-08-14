import { describe, expect, it, vi } from "vitest";
import { createAbandonedUploadCleanup } from "./abandoned-upload-cleanup";

describe("abandoned private upload cleanup", () => {
  it("removes only atomically claimed uploads and releases failed removals", async () => {
    const repository = {
      listCandidates: vi.fn().mockResolvedValue([{ id: "one" }, { id: "two" }]),
      claim: vi.fn()
        .mockResolvedValueOnce({ id: "one", storageKey: "one.bin" })
        .mockResolvedValueOnce({ id: "two", storageKey: "two.bin" }),
      complete: vi.fn().mockResolvedValue(true),
      release: vi.fn().mockResolvedValue(true),
      deleteExpiredEmptySessions: vi.fn().mockResolvedValue(3),
    };
    const store = {
      remove: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("temporary disk failure")),
    };
    const cleanup = createAbandonedUploadCleanup(repository, store, {
      retentionMs: 24 * 60 * 60 * 1_000,
    });
    const now = new Date("2026-08-06T00:00:00Z");

    await expect(cleanup.run(50, now)).resolves.toEqual({
      examined: 2,
      removed: 1,
      failed: 1,
      sessionsDeleted: 3,
    });
    expect(repository.listCandidates).toHaveBeenCalledWith(
      new Date("2026-08-05T00:00:00Z"),
      50,
    );
    expect(repository.complete).toHaveBeenCalledWith("one", now);
    expect(repository.release).toHaveBeenCalledWith("two", now);
  });
});
