import { describe, expect, it, vi } from "vitest";
import {
  createGoogleDataManagerDeliveryProvider,
  createMetaCapiDeliveryProvider,
} from "./conversion-delivery-providers";

const base = {
  id: "11111111-1111-4111-8111-111111111111",
  platform: "google" as const,
  transactionId: "manual-order:22222222-2222-4222-8222-222222222222",
  jobId: "22222222-2222-4222-8222-222222222222",
  eventType: "purchase",
  eventOccurredAt: new Date("2026-08-28T00:00:00.000Z"),
  eventSource: "WEB" as const,
  currency: "AUD" as const,
  valueMinor: 12_345,
  consentSnapshot: { version: 1 as const, decision: "granted" as const, recordedAt: "2026-08-28T00:00:00.000Z", evidenceSource: "manual_order_field" as const, adUserData: "CONSENT_GRANTED" as const, adPersonalization: "CONSENT_DENIED" as const },
  attributionSnapshot: { version: 1 as const, source: "google" as const, gclid: "test-gclid" },
  userDataSnapshot: { version: 1 as const, hashedEmail: "a".repeat(64) },
  requestId: null,
  acceptedAt: null,
  attemptCount: 1,
  leaseToken: "33333333-3333-4333-8333-333333333333",
  work: "ingest" as const,
};

describe("conversion delivery providers", () => {
  it("maps one Google outbox row to one ingest request", async () => {
    const ingest = vi.fn().mockResolvedValue({ outcome: "accepted", requestId: "request-1" });
    const provider = createGoogleDataManagerDeliveryProvider({ maximumAttemptDurationMs: 30_000, ingest, poll: vi.fn() });
    await expect(provider.deliver(base)).resolves.toEqual({ outcome: "accepted", requestId: "request-1" });
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({
      transactionId: base.transactionId,
      conversionValue: 123.45,
      currency: "AUD",
      adIdentifiers: { gclid: "test-gclid" },
      userData: { userIdentifiers: [{ emailAddress: "a".repeat(64) }] },
    }));
  });

  it.each([
    ["PROCESSING", "processing"],
    ["SUCCESS", "succeeded"],
    ["PARTIAL_SUCCESS", "permanent_failed"],
    ["FAILURE", "permanent_failed"],
  ] as const)("maps Google %s without treating partial as success", async (requestStatus, outcome) => {
    const destinations = [{
      requestStatus,
      recordCount: "1",
      errors: requestStatus === "FAILURE" || requestStatus === "PARTIAL_SUCCESS"
        ? [{ reason: "INVALID_EVENT", recordCount: "1" }]
        : [],
      warnings: [],
    }];
    const provider = createGoogleDataManagerDeliveryProvider({
      maximumAttemptDurationMs: 30_000,
      ingest: vi.fn(),
      poll: vi.fn().mockResolvedValue({ outcome: "status", requestStatus, destinations }),
    });
    await expect(provider.deliver({ ...base, requestId: "request-1", work: "poll" })).resolves.toMatchObject({
      outcome,
      diagnostics: {
        version: 1,
        requestStatus,
        destinations,
      },
    });
  });

  it("classifies FAILURE from error_info without marking it succeeded", async () => {
    const permanent = createGoogleDataManagerDeliveryProvider({
      maximumAttemptDurationMs: 30_000,
      ingest: vi.fn(),
      poll: vi.fn().mockResolvedValue({
        outcome: "status",
        requestStatus: "FAILURE",
        destinations: [{
          requestStatus: "FAILURE",
          errors: [{ reason: "PROCESSING_ERROR_REASON_INVALID_GCLID", recordCount: "1" }],
          warnings: [],
        }],
      }),
    });
    await expect(permanent.deliver({ ...base, requestId: "request-1", work: "poll" }))
      .resolves.toMatchObject({
        outcome: "permanent_failed",
        errorCode: "google_failure",
        errorCategory: "invalid_event",
      });

    const retryable = createGoogleDataManagerDeliveryProvider({
      maximumAttemptDurationMs: 30_000,
      ingest: vi.fn(),
      poll: vi.fn().mockResolvedValue({
        outcome: "status",
        requestStatus: "FAILURE",
        destinations: [{
          requestStatus: "FAILURE",
          errors: [{ reason: "PROCESSING_ERROR_REASON_INTERNAL_ERROR", recordCount: "1" }],
          warnings: [],
        }],
      }),
    });
    await expect(retryable.deliver({ ...base, requestId: "request-2", work: "poll" }))
      .resolves.toMatchObject({
        outcome: "retryable_failed",
        errorCode: "google_failure_retryable",
        errorCategory: "provider_server",
      });
  });

  it("maps transport and HTTP boundaries", async () => {
    const retry = createGoogleDataManagerDeliveryProvider({
      maximumAttemptDurationMs: 30_000,
      ingest: vi.fn().mockResolvedValue({ outcome: "http_error", status: 429 }),
      poll: vi.fn(),
    });
    await expect(retry.deliver(base)).resolves.toMatchObject({ outcome: "retryable_failed", errorCategory: "rate_limit" });
    const permanent = createGoogleDataManagerDeliveryProvider({
      maximumAttemptDurationMs: 30_000,
      ingest: vi.fn().mockResolvedValue({ outcome: "http_error", status: 400 }),
      poll: vi.fn(),
    });
    await expect(permanent.deliver(base)).resolves.toMatchObject({ outcome: "permanent_failed", errorCategory: "invalid_event" });
  });

  it("maps Meta Purchase without exposing raw customer data", async () => {
    const send = vi.fn().mockResolvedValue("sent");
    const provider = createMetaCapiDeliveryProvider({ maximumAttemptDurationMs: 30_000, send });
    await expect(provider.deliver({
      ...base,
      platform: "meta",
      eventSource: "MESSAGE",
      attributionSnapshot: { version: 1, source: "meta", fbp: "fb.1.1720000000000.123456" },
    })).resolves.toEqual({ outcome: "succeeded" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      name: "Purchase",
      eventId: `purchase:manual:${base.jobId}`,
      actionSource: "business_messaging",
      currency: "AUD",
      value: 123.45,
      hashedEmail: "a".repeat(64),
    }));
    expect(JSON.stringify(send.mock.calls)).not.toMatch(/address|photo|artwork|proof/i);
  });
});
