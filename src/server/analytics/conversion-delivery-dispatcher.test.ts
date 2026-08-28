import { describe, expect, it, vi } from "vitest";
import {
  conversionDeliveryRuntimeEnabled,
  createConversionDeliveryDispatcher,
} from "./conversion-delivery-dispatcher";

const now = new Date("2026-08-28T01:00:00.000Z");
const delivery = Object.freeze({
  id: "11111111-1111-4111-8111-111111111111",
  platform: "google" as const,
  transactionId: "manual-order:22222222-2222-4222-8222-222222222222",
  jobId: "22222222-2222-4222-8222-222222222222",
  eventType: "purchase",
  eventOccurredAt: new Date("2026-08-28T00:00:00.000Z"),
  eventSource: "WEB" as const,
  currency: "NZD" as const,
  valueMinor: 20_000,
  consentSnapshot: { version: 1 as const, decision: "granted" as const, recordedAt: "2026-08-28T00:00:00.000Z", evidenceSource: "manual_order_field" as const, adUserData: "CONSENT_GRANTED" as const, adPersonalization: "CONSENT_DENIED" as const },
  attributionSnapshot: { version: 1 as const, source: "google" as const, gclid: "test" },
  userDataSnapshot: { version: 1 as const, hashedEmail: "a".repeat(64) },
  requestId: null,
  acceptedAt: null,
  attemptCount: 1,
  leaseToken: "33333333-3333-4333-8333-333333333333",
  work: "ingest" as const,
});

function dependencies(result: unknown, overrides: Record<string, unknown> = {}) {
  return {
    repository: {
      recoverStaleClaims: vi.fn().mockResolvedValue(0),
      claimNext: vi.fn().mockResolvedValue(delivery),
      markAccepted: vi.fn().mockResolvedValue(true),
      markProcessing: vi.fn().mockResolvedValue(true),
      markSucceeded: vi.fn().mockResolvedValue(true),
      markRetryableFailed: vi.fn().mockResolvedValue(true),
      markPermanentFailed: vi.fn().mockResolvedValue(true),
      markDeadLetter: vi.fn().mockResolvedValue(true),
    },
    provider: { maximumAttemptDurationMs: 30_000, deliver: vi.fn().mockResolvedValue(result) },
    enabled: true,
    now: () => now,
    createLeaseToken: () => delivery.leaseToken,
    ...overrides,
  };
}

describe("conversion delivery dispatcher", () => {
  it("requires every runtime safety gate before claiming or calling a provider", () => {
    const ready = {
      globalEnabled: true,
      platformEnabled: true,
      activationConfigured: true,
      durableRepositoryReady: true,
      credentialsConfigured: true,
      destinationConfigured: true,
    };
    expect(conversionDeliveryRuntimeEnabled(ready)).toBe(true);
    for (const key of Object.keys(ready) as (keyof typeof ready)[]) {
      expect(conversionDeliveryRuntimeEnabled({ ...ready, [key]: false })).toBe(false);
    }
  });

  it("does not claim or call a provider when runtime is disabled", async () => {
    const deps = dependencies({ outcome: "succeeded" }, { enabled: false });
    await expect(createConversionDeliveryDispatcher(deps as never).runOnce("google")).resolves.toEqual({ outcome: "disabled" });
    expect(deps.repository.claimNext).not.toHaveBeenCalled();
    expect(deps.provider.deliver).not.toHaveBeenCalled();
  });

  it("rejects a provider deadline that can outlive its actual delivery lease", () => {
    const deps = dependencies({ outcome: "succeeded" }, { leaseDurationMs: 30_000 });
    expect(() => createConversionDeliveryDispatcher(deps as never)).toThrow("shorter");
  });

  it("stores an accepted request and waits 30 minutes before first poll", async () => {
    const deps = dependencies({ outcome: "accepted", requestId: "request-1" });
    await expect(createConversionDeliveryDispatcher(deps as never).runOnce("google")).resolves.toEqual({ outcome: "accepted" });
    expect(deps.repository.markAccepted).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "request-1",
      nextAttemptAt: new Date(now.getTime() + 30 * 60_000),
    }));
  });

  it("keeps PROCESSING nonterminal with bounded 1.3 polling backoff", async () => {
    const acceptedAt = new Date(now.getTime() - 31 * 60_000);
    const deps = dependencies({ outcome: "processing" });
    deps.repository.claimNext.mockResolvedValue({ ...delivery, requestId: "request-1", acceptedAt, work: "poll", attemptCount: 3 });
    await expect(createConversionDeliveryDispatcher(deps as never).runOnce("google")).resolves.toEqual({ outcome: "processing" });
    const nextAttemptAt = deps.repository.markProcessing.mock.calls[0][0].nextAttemptAt as Date;
    expect(nextAttemptAt.getTime() - now.getTime()).toBeGreaterThan(30 * 60_000);
    expect(nextAttemptAt.getTime() - now.getTime()).toBeLessThanOrEqual(60 * 60_000);
    expect(deps.repository.markSucceeded).not.toHaveBeenCalled();
  });

  it("marks SUCCESS terminal and PARTIAL_SUCCESS permanent", async () => {
    const diagnostics = {
      version: 1 as const,
      requestStatus: "SUCCESS",
      destinations: [],
    };
    const success = dependencies({ outcome: "succeeded", diagnostics });
    await createConversionDeliveryDispatcher(success as never).runOnce("google");
    expect(success.repository.markSucceeded).toHaveBeenCalledWith(expect.objectContaining({ diagnostics }));

    const partial = dependencies({ outcome: "permanent_failed", errorCode: "partial_success", errorCategory: "partial_success", diagnostics });
    await createConversionDeliveryDispatcher(partial as never).runOnce("google");
    expect(partial.repository.markPermanentFailed).toHaveBeenCalledWith(expect.objectContaining({ errorCategory: "partial_success", diagnostics }));
  });

  it("schedules retryable transport errors and dead-letters exhausted work", async () => {
    const retry = dependencies({ outcome: "retryable_failed", errorCode: "timeout", errorCategory: "transport" });
    await createConversionDeliveryDispatcher(retry as never).runOnce("google");
    expect(retry.repository.markRetryableFailed).toHaveBeenCalledWith(expect.objectContaining({ nextAttemptAt: expect.any(Date) }));

    const exhausted = dependencies({ outcome: "retryable_failed", errorCode: "timeout", errorCategory: "transport" });
    exhausted.repository.claimNext.mockResolvedValue({ ...delivery, attemptCount: 12 });
    await createConversionDeliveryDispatcher(exhausted as never).runOnce("google");
    expect(exhausted.repository.markDeadLetter).toHaveBeenCalledOnce();
  });

  it("dead-letters Google diagnostics still processing after 24 hours", async () => {
    const deps = dependencies({ outcome: "processing" });
    deps.repository.claimNext.mockResolvedValue({
      ...delivery,
      requestId: "request-1",
      acceptedAt: new Date(now.getTime() - 24 * 60 * 60_000 - 1),
      work: "poll",
    });
    await createConversionDeliveryDispatcher(deps as never).runOnce("google");
    expect(deps.repository.markDeadLetter).toHaveBeenCalledWith(expect.objectContaining({
      errorCategory: "observation_timeout",
    }));
  });
});
