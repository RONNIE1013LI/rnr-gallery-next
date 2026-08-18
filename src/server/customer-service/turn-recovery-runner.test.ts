import { describe, expect, it, vi } from "vitest";
import { createCustomerTurnRecoveryRunner } from "./turn-recovery-runner";
import type { DraftGenerationResult } from "./types";

const now = new Date("2026-08-19T00:00:00.000Z");

function setup() {
  const repository = {
    claimDueCustomerTurn: vi.fn<() => Promise<{
      turnId: string;
      messageId: string;
      leaseToken: string;
    } | null>>(async () => ({
      turnId: "turn-1",
      messageId: "message-1",
      leaseToken: "lease-1",
    })),
    completeCustomerTurnProcessing: vi.fn(async () => true),
    retryCustomerTurnProcessing: vi.fn(async () => true),
  };
  const generateDraft = vi.fn<() => Promise<DraftGenerationResult>>(async () => ({
    status: "draft_ready" as const,
    attemptId: "attempt-1",
  }));
  const runner = createCustomerTurnRecoveryRunner({
    repository,
    generateDraft,
    now: () => now,
    leaseMs: 300_000,
    retryDelayMs: 60_000,
  });
  return { repository, generateDraft, runner };
}

describe("customer turn recovery runner", () => {
  it("completes a persisted turn when webhook after() never runs", async () => {
    const current = setup();

    await expect(current.runner.runOnce()).resolves.toEqual({
      claimed: 1,
      completed: 1,
      retried: 0,
      cancelled: 0,
    });
    expect(current.repository.claimDueCustomerTurn).toHaveBeenCalledWith({
      now,
      leaseExpiresAt: new Date("2026-08-19T00:05:00.000Z"),
    });
    expect(current.generateDraft).toHaveBeenCalledOnce();
    expect(current.repository.completeCustomerTurnProcessing).toHaveBeenCalledWith({
      turnId: "turn-1",
      leaseToken: "lease-1",
      now,
      outcome: "draft_ready",
    });
  });

  it("lets after() and recovery share the same exact-turn executor", async () => {
    const current = setup();

    await current.runner.runOnce({ turnId: "turn-1" });

    expect(current.repository.claimDueCustomerTurn).toHaveBeenCalledWith({
      turnId: "turn-1",
      now,
      leaseExpiresAt: new Date("2026-08-19T00:05:00.000Z"),
    });
  });

  it("does nothing when another worker or a human reply already owns the turn", async () => {
    const current = setup();
    current.repository.claimDueCustomerTurn.mockResolvedValueOnce(null);

    await expect(current.runner.runOnce()).resolves.toEqual({
      claimed: 0,
      completed: 0,
      retried: 0,
      cancelled: 0,
    });
    expect(current.generateDraft).not.toHaveBeenCalled();
  });

  it("requeues transient generation failures without losing durable state", async () => {
    const current = setup();
    current.generateDraft.mockResolvedValueOnce({ status: "provider_error", attemptId: "attempt-1" });

    await expect(current.runner.runOnce()).resolves.toEqual({
      claimed: 1,
      completed: 0,
      retried: 1,
      cancelled: 0,
    });
    expect(current.repository.retryCustomerTurnProcessing).toHaveBeenCalledWith({
      turnId: "turn-1",
      leaseToken: "lease-1",
      nextRunAt: new Date("2026-08-19T00:01:00.000Z"),
      errorCode: "provider_error",
    });
  });

  it("does not publish stale completion when a human outbound echo cancels the lease", async () => {
    const current = setup();
    current.repository.completeCustomerTurnProcessing.mockResolvedValueOnce(false);

    await expect(current.runner.runOnce()).resolves.toEqual({
      claimed: 1,
      completed: 0,
      retried: 0,
      cancelled: 1,
    });
  });

  it("requeues thrown interruptions without exposing the error", async () => {
    const current = setup();
    current.generateDraft.mockRejectedValueOnce(new Error("private provider detail"));

    await expect(current.runner.runOnce()).resolves.toEqual({
      claimed: 1,
      completed: 0,
      retried: 1,
      cancelled: 0,
    });
    expect(current.repository.retryCustomerTurnProcessing).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: "turn_processing_interrupted",
    }));
  });
});
