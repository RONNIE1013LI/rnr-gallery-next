import { describe, expect, it, vi } from "vitest";
import { createCustomerTurnRecoveryRunner } from "./turn-recovery-runner";
import type { DraftGenerationResult } from "./types";

const now = new Date("2026-08-19T00:00:00.000Z");

function setup() {
  const repository = {
    claimDueCustomerTurn: vi.fn<() => Promise<{
      turnId: string;
      messageId: string;
      channel: "facebook" | "website";
      leaseToken: string;
      processingAttempt: number;
      settledResult?: DraftGenerationResult;
    } | null>>(async () => ({
      turnId: "turn-1",
      messageId: "message-1",
      channel: "facebook",
      leaseToken: "lease-1",
      processingAttempt: 1,
    })),
    openWebsiteHumanReview: vi.fn<(input: unknown) => Promise<
      | Readonly<{ status: "opened"; reviewId: string; generation: number }>
      | Readonly<{ status: "reused"; reviewId: string; generation: number }>
      | Readonly<{ status: "cancelled" }>
    >>(async () => ({ status: "opened", reviewId: "review-1", generation: 1 })),
    completeCustomerTurnProcessing: vi.fn(async () => true),
    retryCustomerTurnProcessing: vi.fn(async () => true),
    exhaustCustomerTurnProcessing: vi.fn(async () => true),
  };
  const generateDraft = vi.fn<() => Promise<DraftGenerationResult>>(async () => ({
    status: "draft_ready" as const,
    attemptId: "attempt-1",
  }));
  const runner = createCustomerTurnRecoveryRunner({
    repository,
    generateDraft,
    knowledgeVersion: "knowledge-v1",
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

  it("opens one website human-review incident instead of retrying a provider failure", async () => {
    const current = setup();
    current.repository.claimDueCustomerTurn.mockResolvedValueOnce({
      turnId: "turn-website",
      messageId: "message-website",
      channel: "website",
      leaseToken: "lease-website",
      processingAttempt: 1,
    });
    current.generateDraft.mockResolvedValueOnce({ status: "provider_error", attemptId: "attempt-provider-error" });

    await expect(current.runner.runOnce()).resolves.toEqual({
      claimed: 1,
      completed: 1,
      retried: 0,
      cancelled: 0,
    });
    expect(current.repository.openWebsiteHumanReview).toHaveBeenCalledWith({
      turnId: "turn-website",
      leaseToken: "lease-website",
      attemptId: "attempt-provider-error",
      outcome: "provider_error",
      now,
      knowledgeVersion: "knowledge-v1",
    });
    expect(current.repository.retryCustomerTurnProcessing).not.toHaveBeenCalled();
  });

  it.each([
    ["gate_blocked", "attempt-gate"],
    ["realtime_required", "attempt-realtime"],
    ["budget_blocked", "attempt-budget"],
    ["output_blocked", "attempt-output"],
  ] as const)("opens website human review for %s", async (status, attemptId) => {
    const current = setup();
    current.repository.claimDueCustomerTurn.mockResolvedValueOnce({
      turnId: "turn-website",
      messageId: "message-website",
      channel: "website",
      leaseToken: "lease-website",
      processingAttempt: 1,
    });
    current.generateDraft.mockResolvedValueOnce({ status, attemptId });

    await current.runner.runOnce();

    expect(current.repository.openWebsiteHumanReview).toHaveBeenCalledWith(expect.objectContaining({
      outcome: status,
      attemptId,
    }));
    expect(current.repository.retryCustomerTurnProcessing).not.toHaveBeenCalled();
  });

  it.each([
    ["high_risk", { status: "gate_blocked", attemptId: "attempt-high-risk" }],
    ["unresolved", { status: "gate_blocked", attemptId: "attempt-unresolved" }],
    ["budget_blocked", { status: "budget_blocked", attemptId: "attempt-budget" }],
    ["provider_error", { status: "provider_error", attemptId: "attempt-provider" }],
    ["output_blocked", { status: "output_blocked", attemptId: "attempt-output" }],
  ] as const)("recovers persisted website %s without another provider call", async (_case, settledResult) => {
    const current = setup();
    current.repository.claimDueCustomerTurn.mockResolvedValueOnce({
      turnId: "turn-website",
      messageId: "message-website",
      channel: "website",
      leaseToken: "lease-website",
      processingAttempt: 2,
      settledResult,
    });

    await current.runner.runOnce();

    expect(current.generateDraft).not.toHaveBeenCalled();
    expect(current.repository.openWebsiteHumanReview).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: settledResult.attemptId,
      outcome: settledResult.status,
    }));
  });

  it("does not retry or complete after a human outbound cancels review creation", async () => {
    const current = setup();
    current.repository.claimDueCustomerTurn.mockResolvedValueOnce({
      turnId: "turn-website",
      messageId: "message-website",
      channel: "website",
      leaseToken: "lease-website",
      processingAttempt: 2,
      settledResult: { status: "gate_blocked", attemptId: "attempt-existing" },
    });
    current.repository.openWebsiteHumanReview.mockResolvedValueOnce({ status: "cancelled" });

    await expect(current.runner.runOnce()).resolves.toEqual({
      claimed: 1,
      completed: 0,
      retried: 0,
      cancelled: 1,
    });
    expect(current.generateDraft).not.toHaveBeenCalled();
    expect(current.repository.completeCustomerTurnProcessing).not.toHaveBeenCalled();
    expect(current.repository.retryCustomerTurnProcessing).not.toHaveBeenCalled();
  });

  it("opens the governed fallback review when website processing throws", async () => {
    const current = setup();
    current.repository.claimDueCustomerTurn.mockResolvedValueOnce({
      turnId: "turn-website",
      messageId: "message-website",
      channel: "website",
      leaseToken: "lease-website",
      processingAttempt: 1,
    });
    current.generateDraft.mockRejectedValueOnce(new Error("provider detail must not reach the customer"));

    await current.runner.runOnce();

    expect(current.repository.openWebsiteHumanReview).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: null,
      outcome: "system_failure",
    }));
    expect(current.repository.retryCustomerTurnProcessing).not.toHaveBeenCalled();
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

  it("uses bounded exponential retry delays", async () => {
    const current = setup();
    current.repository.claimDueCustomerTurn.mockResolvedValueOnce({
      turnId: "turn-1",
      messageId: "message-1",
      channel: "facebook",
      leaseToken: "lease-2",
      processingAttempt: 2,
    });
    current.generateDraft.mockResolvedValueOnce({ status: "provider_error", attemptId: "attempt-2" });

    await current.runner.runOnce();

    expect(current.repository.retryCustomerTurnProcessing).toHaveBeenCalledWith(expect.objectContaining({
      nextRunAt: new Date("2026-08-19T00:02:00.000Z"),
    }));
  });

  it("stops retrying after the third failed processing attempt", async () => {
    const current = setup();
    current.repository.claimDueCustomerTurn.mockResolvedValueOnce({
      turnId: "turn-1",
      messageId: "message-1",
      channel: "facebook",
      leaseToken: "lease-3",
      processingAttempt: 3,
    });
    current.generateDraft.mockResolvedValueOnce({ status: "provider_error", attemptId: "attempt-3" });

    await expect(current.runner.runOnce()).resolves.toEqual({
      claimed: 1,
      completed: 1,
      retried: 0,
      cancelled: 0,
    });
    expect(current.repository.retryCustomerTurnProcessing).not.toHaveBeenCalled();
    expect(current.repository.exhaustCustomerTurnProcessing).toHaveBeenCalledWith({
      turnId: "turn-1",
      leaseToken: "lease-3",
      now,
      errorCode: "provider_retry_exhausted",
    });
  });
});
