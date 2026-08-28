import { describe, expect, it, vi } from "vitest";
import {
  createConversionDeliveryWorker,
  resolveConversionDeliveryWorkerConfig,
} from "./conversion-delivery-worker";

const enabledEnvironment = Object.freeze({
  MANUAL_OFFLINE_CONVERSIONS_ENABLED: "true",
  GOOGLE_MANUAL_CONVERSIONS_ENABLED: "true",
  GOOGLE_MANUAL_CONVERSIONS_ACTIVATED_AT: "2026-08-28T00:00:00.000Z",
  GOOGLE_DATA_MANAGER_OPERATING_ACCOUNT_ID: "1234567890",
  GOOGLE_DATA_MANAGER_PRODUCT_DESTINATION_ID: "987654321",
  GOOGLE_DATA_MANAGER_OAUTH_CLIENT_ID: "client-id",
  GOOGLE_DATA_MANAGER_OAUTH_CLIENT_SECRET: "client-secret",
  GOOGLE_DATA_MANAGER_OAUTH_REFRESH_TOKEN: "refresh-token",
  META_MANUAL_CONVERSIONS_ENABLED: "true",
  META_MANUAL_CONVERSIONS_ACTIVATED_AT: "2026-08-28T00:00:00.000Z",
  META_CAPI_ACCESS_TOKEN: "meta-token",
});

function repository() {
  return {
    recoverStaleClaims: vi.fn().mockResolvedValue(0),
    claimNext: vi.fn().mockResolvedValue(null),
    markAccepted: vi.fn(),
    markProcessing: vi.fn(),
    markSucceeded: vi.fn(),
    markRetryableFailed: vi.fn(),
    markPermanentFailed: vi.fn(),
    markDeadLetter: vi.fn(),
  };
}

function provider() {
  return { maximumAttemptDurationMs: 30_000, deliver: vi.fn() };
}

describe("conversion delivery worker", () => {
  it("requires exact flags, valid activation, destination, and provider credentials", () => {
    expect(resolveConversionDeliveryWorkerConfig(enabledEnvironment)).toEqual({
      googleEnabled: true,
      metaEnabled: true,
    });
    for (const [key, value] of [
      ["MANUAL_OFFLINE_CONVERSIONS_ENABLED", undefined],
      ["MANUAL_OFFLINE_CONVERSIONS_ENABLED", "yes"],
      ["GOOGLE_MANUAL_CONVERSIONS_ENABLED", "TRUE"],
      ["GOOGLE_MANUAL_CONVERSIONS_ACTIVATED_AT", "invalid"],
      ["GOOGLE_DATA_MANAGER_PRODUCT_DESTINATION_ID", ""],
      ["GOOGLE_DATA_MANAGER_OAUTH_REFRESH_TOKEN", ""],
    ] as const) {
      expect(resolveConversionDeliveryWorkerConfig({
        ...enabledEnvironment,
        [key]: value,
      }).googleEnabled, `${key}=${String(value)}`).toBe(false);
    }
    for (const [key, value] of [
      ["META_MANUAL_CONVERSIONS_ENABLED", "1"],
      ["META_MANUAL_CONVERSIONS_ACTIVATED_AT", ""],
      ["META_CAPI_ACCESS_TOKEN", ""],
    ] as const) {
      expect(resolveConversionDeliveryWorkerConfig({
        ...enabledEnvironment,
        [key]: value,
      }).metaEnabled, `${key}=${String(value)}`).toBe(false);
    }
  });

  it("does not open the database or call providers while both platform gates are closed", async () => {
    const createRepository = vi.fn();
    const google = provider();
    const meta = provider();
    const worker = createConversionDeliveryWorker({
      env: {},
      createRepository,
      googleProvider: google,
      metaProvider: meta,
    });

    await expect(worker.run(10)).resolves.toEqual({
      result: "disabled",
      googleProcessed: 0,
      metaProcessed: 0,
    });
    expect(createRepository).not.toHaveBeenCalled();
    expect(google.deliver).not.toHaveBeenCalled();
    expect(meta.deliver).not.toHaveBeenCalled();
  });

  it("fails closed before provider delivery when the database is unavailable", async () => {
    const google = provider();
    const worker = createConversionDeliveryWorker({
      env: { ...enabledEnvironment, META_MANUAL_CONVERSIONS_ENABLED: "false" },
      createRepository: () => { throw new Error("database unavailable"); },
      googleProvider: google,
      metaProvider: null,
    });

    await expect(worker.run(10)).resolves.toEqual({
      result: "unavailable",
      googleProcessed: 0,
      metaProcessed: 0,
    });
    expect(google.deliver).not.toHaveBeenCalled();
  });

  it("runs bounded Google and Meta dispatcher passes including stale recovery", async () => {
    const repo = repository();
    const worker = createConversionDeliveryWorker({
      env: enabledEnvironment,
      createRepository: () => repo,
      googleProvider: provider(),
      metaProvider: provider(),
      createLeaseToken: () => "11111111-1111-4111-8111-111111111111",
    });

    await expect(worker.run(3)).resolves.toEqual({
      result: "processed",
      googleProcessed: 0,
      metaProcessed: 0,
    });
    expect(repo.recoverStaleClaims).toHaveBeenCalledTimes(2);
    expect(repo.claimNext).toHaveBeenCalledTimes(2);
  });

  it("polls an accepted Google request from the recurring worker instead of ingesting it again", async () => {
    const repo = repository();
    const accepted = {
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
      attributionSnapshot: { version: 1 as const, source: "google" as const, gclid: "gclid" },
      userDataSnapshot: { version: 1 as const, hashedEmail: "a".repeat(64) },
      requestId: "request-1",
      acceptedAt: new Date("2026-08-28T00:00:00.000Z"),
      attemptCount: 2,
      leaseToken: "33333333-3333-4333-8333-333333333333",
      work: "poll" as const,
    };
    repo.claimNext.mockResolvedValueOnce(accepted).mockResolvedValueOnce(null);
    repo.markProcessing.mockResolvedValue(true);
    const google = provider();
    google.deliver.mockResolvedValue({ outcome: "processing" });
    const worker = createConversionDeliveryWorker({
      env: { ...enabledEnvironment, META_MANUAL_CONVERSIONS_ENABLED: "false" },
      createRepository: () => repo,
      googleProvider: google,
      metaProvider: null,
      now: () => new Date("2026-08-28T01:00:00.000Z"),
      createLeaseToken: () => accepted.leaseToken,
    });

    await expect(worker.run(3)).resolves.toMatchObject({
      result: "processed",
      googleProcessed: 1,
    });
    expect(google.deliver).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "request-1",
      work: "poll",
    }));
    expect(repo.markProcessing).toHaveBeenCalledOnce();
  });
});
