import { describe, expect, it, vi } from "vitest";
import { createPaymentProofRetentionCleanup } from "./payment-proof-retention-cleanup";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1_000;

function createRepository() {
  return {
    report: vi.fn().mockResolvedValue({ eligible: 2, eligibleBytes: 12_345 }),
    listCandidates: vi.fn().mockResolvedValue([{ id: "one" }, { id: "two" }]),
    purge: vi.fn()
      .mockResolvedValueOnce("deleted")
      .mockResolvedValueOnce("ineligible"),
  };
}

describe("payment-proof retention cleanup", () => {
  it("reports files eligible seven days after both arrival and upload", async () => {
    const repository = createRepository();
    const store = { remove: vi.fn() };
    const cleanup = createPaymentProofRetentionCleanup(repository, store);
    const now = new Date("2026-08-26T00:00:00Z");

    await expect(cleanup.report(now)).resolves.toEqual({
      eligible: 2,
      eligibleBytes: 12_345,
    });
    expect(repository.report).toHaveBeenCalledWith(
      new Date(now.getTime() - SEVEN_DAYS_MS),
    );
    expect(store.remove).not.toHaveBeenCalled();
  });

  it("deletes only candidates that remain eligible and bounds each run", async () => {
    const repository = createRepository();
    const store = { remove: vi.fn().mockResolvedValue(undefined) };
    const cleanup = createPaymentProofRetentionCleanup(repository, store);
    const now = new Date("2026-08-26T00:00:00Z");

    await expect(cleanup.run(50, now)).resolves.toEqual({
      examined: 2,
      deleted: 1,
      skipped: 1,
      failed: 0,
    });
    const cutoff = new Date(now.getTime() - SEVEN_DAYS_MS);
    expect(repository.listCandidates).toHaveBeenCalledWith(cutoff, 50);
    expect(repository.purge).toHaveBeenNthCalledWith(
      1,
      "one",
      cutoff,
      now,
      expect.any(Function),
    );
  });

  it("keeps failed deletions eligible for a later retry", async () => {
    const repository = createRepository();
    repository.listCandidates.mockResolvedValue([{ id: "one" }]);
    repository.purge.mockReset().mockRejectedValue(new Error("temporary blob failure"));
    const cleanup = createPaymentProofRetentionCleanup(repository, { remove: vi.fn() });

    await expect(cleanup.run()).resolves.toEqual({
      examined: 1,
      deleted: 0,
      skipped: 0,
      failed: 1,
    });
  });

  it("rejects unsafe retention and batch limits", () => {
    const repository = createRepository();
    expect(() => createPaymentProofRetentionCleanup(repository, { remove: vi.fn() }, {
      retentionMs: -1,
    })).toThrow("Payment-proof retention must be a non-negative integer");
    const cleanup = createPaymentProofRetentionCleanup(repository, { remove: vi.fn() });
    expect(() => cleanup.run(0)).toThrow("Payment-proof cleanup limit must be between 1 and 100");
    expect(() => cleanup.run(101)).toThrow("Payment-proof cleanup limit must be between 1 and 100");
  });
});
