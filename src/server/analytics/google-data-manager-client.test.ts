import { describe, expect, it, vi } from "vitest";

import type { GoogleDataManagerEvent } from "@/domain/analytics/google-data-manager";
import {
  GOOGLE_DATA_MANAGER_INGEST_URL,
  GOOGLE_DATA_MANAGER_OAUTH_SCOPE,
  GOOGLE_DATA_MANAGER_STATUS_URL,
  createGoogleDataManagerClient,
  parseGoogleDataManagerDestinationConfig,
  type GoogleDataManagerDeliveryRepository,
} from "./google-data-manager-client";

const event: GoogleDataManagerEvent = Object.freeze({
  transactionId: "manual:JOB-2026-002",
  eventTimestamp: "2026-09-02T10:15:30.000Z",
  conversionValue: 123.45,
  currency: "NZD",
  eventSource: "WEB",
  adIdentifiers: Object.freeze({ gclid: "fake-gclid-002" }),
  consent: Object.freeze({
    adUserData: "CONSENT_GRANTED",
    adPersonalization: "CONSENT_DENIED",
  }),
});

const config = parseGoogleDataManagerDestinationConfig({
  GOOGLE_DATA_MANAGER_OPERATING_ACCOUNT_ID: "123-456-7890",
  GOOGLE_DATA_MANAGER_PRODUCT_DESTINATION_ID: "987654321",
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function testTokenProvider(
  getAccessToken = vi.fn().mockResolvedValue("access"),
  refreshAccessToken = vi.fn().mockResolvedValue("refreshed-access"),
) {
  return { getAccessToken, refreshAccessToken };
}

function deliveryRepository(
  claimResult: Awaited<ReturnType<GoogleDataManagerDeliveryRepository["claim"]>> = {
    outcome: "claimed",
  },
): GoogleDataManagerDeliveryRepository & {
  claim: ReturnType<typeof vi.fn>;
  markAccepted: ReturnType<typeof vi.fn>;
  markOutcome: ReturnType<typeof vi.fn>;
} {
  return {
    claim: vi.fn().mockResolvedValue(claimResult),
    markAccepted: vi.fn().mockResolvedValue(undefined),
    markOutcome: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Google Data Manager destination config", () => {
  it("normalizes a direct Google Ads destination and omits login and linked accounts", () => {
    expect(config).toEqual({
      destination: {
        operatingAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" },
        productDestinationId: "987654321",
      },
    });
    expect(config?.destination).not.toHaveProperty("loginAccount");
    expect(config?.destination).not.toHaveProperty("linkedAccount");
  });

  it("includes only a complete supported Google Ads manager login account", () => {
    expect(parseGoogleDataManagerDestinationConfig({
      GOOGLE_DATA_MANAGER_OPERATING_ACCOUNT_ID: "123 456 7890",
      GOOGLE_DATA_MANAGER_PRODUCT_DESTINATION_ID: "987654321",
      GOOGLE_DATA_MANAGER_LOGIN_ACCOUNT_TYPE: "GOOGLE_ADS",
      GOOGLE_DATA_MANAGER_LOGIN_ACCOUNT_ID: "111-222-3334",
    })).toEqual({
      destination: {
        operatingAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" },
        loginAccount: { accountType: "GOOGLE_ADS", accountId: "1112223334" },
        productDestinationId: "987654321",
      },
    });

    expect(parseGoogleDataManagerDestinationConfig({
      GOOGLE_DATA_MANAGER_OPERATING_ACCOUNT_ID: "1234567890",
      GOOGLE_DATA_MANAGER_PRODUCT_DESTINATION_ID: "987654321",
      GOOGLE_DATA_MANAGER_LOGIN_ACCOUNT_TYPE: "GOOGLE_ADS",
    })).toBeNull();
    expect(parseGoogleDataManagerDestinationConfig({
      GOOGLE_DATA_MANAGER_OPERATING_ACCOUNT_ID: "1234567890",
      GOOGLE_DATA_MANAGER_PRODUCT_DESTINATION_ID: "987654321",
      GOOGLE_DATA_MANAGER_LOGIN_ACCOUNT_ID: "1112223334",
    })).toBeNull();
    expect(parseGoogleDataManagerDestinationConfig({
      GOOGLE_DATA_MANAGER_OPERATING_ACCOUNT_ID: "1234567890",
      GOOGLE_DATA_MANAGER_PRODUCT_DESTINATION_ID: "987654321",
      GOOGLE_DATA_MANAGER_LOGIN_ACCOUNT_TYPE: "DATA_PARTNER",
      GOOGLE_DATA_MANAGER_LOGIN_ACCOUNT_ID: "1112223334",
    })).toBeNull();
  });

  it("fails closed for missing, malformed, or linked-account destination input", () => {
    expect(parseGoogleDataManagerDestinationConfig({})).toBeNull();
    expect(parseGoogleDataManagerDestinationConfig({
      GOOGLE_DATA_MANAGER_OPERATING_ACCOUNT_ID: "1234567890",
    })).toBeNull();
    expect(parseGoogleDataManagerDestinationConfig({
      GOOGLE_DATA_MANAGER_OPERATING_ACCOUNT_ID: "1234A67890",
      GOOGLE_DATA_MANAGER_PRODUCT_DESTINATION_ID: "987654321",
    })).toBeNull();
    expect(parseGoogleDataManagerDestinationConfig({
      GOOGLE_DATA_MANAGER_OPERATING_ACCOUNT_ID: "1234567890",
      GOOGLE_DATA_MANAGER_PRODUCT_DESTINATION_ID: "conversion-action",
    })).toBeNull();
    expect(parseGoogleDataManagerDestinationConfig({
      GOOGLE_DATA_MANAGER_OPERATING_ACCOUNT_ID: "1234567890",
      GOOGLE_DATA_MANAGER_PRODUCT_DESTINATION_ID: "987654321",
      GOOGLE_DATA_MANAGER_LINKED_ACCOUNT_ID: "2223334445",
    })).toBeNull();
  });
});

describe("Google Data Manager diagnostic", () => {
  it("uses the exact scope and endpoint with a forced synthetic validate-only request", async () => {
    const tokenProvider = testTokenProvider(
      vi.fn().mockResolvedValue("synthetic-access-token"),
    );
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      fieldWarnings: [{
        reason: "WARNING_REASON_GENERIC",
        field: "events[0].eventSource",
        description: "do not retain this provider description",
      }],
    }));
    const client = createGoogleDataManagerClient({
      config,
      tokenProvider,
      fetchImpl,
      now: () => new Date("2026-09-03T01:02:03.000Z"),
    });

    await expect(client.validateSynthetic()).resolves.toEqual({
      outcome: "validate_only_success",
      fieldWarnings: [{
        reason: "WARNING_REASON_GENERIC",
        field: "events[0].eventSource",
      }],
    });
    expect(GOOGLE_DATA_MANAGER_OAUTH_SCOPE).toBe("https://www.googleapis.com/auth/datamanager");
    expect(GOOGLE_DATA_MANAGER_INGEST_URL).toBe("https://datamanager.googleapis.com/v1/events:ingest");
    expect(GOOGLE_DATA_MANAGER_STATUS_URL).toBe("https://datamanager.googleapis.com/v1/requestStatus:retrieve");
    expect(tokenProvider.getAccessToken).toHaveBeenCalledWith(GOOGLE_DATA_MANAGER_OAUTH_SCOPE);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toBe(GOOGLE_DATA_MANAGER_INGEST_URL);
    expect(request.method).toBe("POST");
    expect(request.headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer synthetic-access-token",
      "Content-Type": "application/json",
    });
    expect(request.headers).not.toHaveProperty("developer-token");
    const body = JSON.parse(String(request.body));
    expect(body).toEqual({
      destinations: [config?.destination],
      events: [{
        transactionId: "diagnostic:synthetic",
        eventTimestamp: "2026-09-03T01:02:03.000Z",
        conversionValue: 1,
        currency: "NZD",
        eventSource: "OTHER",
        adIdentifiers: { gclid: "synthetic-diagnostic-gclid" },
        consent: {
          adUserData: "CONSENT_GRANTED",
          adPersonalization: "CONSENT_DENIED",
        },
      }],
      encoding: "HEX",
      validateOnly: true,
    });
    expect(body).not.toHaveProperty("consent");
    expect(JSON.stringify(body)).not.toMatch(/@|phone|address|linkedAccount/i);
  });
});

describe("Google Data Manager execution", () => {
  it("blocks before token acquisition or HTTP without a complete durable repository capability", async () => {
    const tokenProvider = testTokenProvider(vi.fn());
    const fetchImpl = vi.fn();
    const client = createGoogleDataManagerClient({ config, tokenProvider, fetchImpl });
    const incompleteRepository = { claim: vi.fn() } as never;

    await expect(client.execute(event)).resolves.toEqual({ outcome: "blocked_no_durable_store" });
    await expect(client.execute(event, incompleteRepository)).resolves.toEqual({
      outcome: "blocked_no_durable_store",
    });
    expect(tokenProvider.getAccessToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends validateOnly false, persists acceptance, and succeeds only after destination SUCCESS", async () => {
    const repository = deliveryRepository();
    const tokenProvider = testTokenProvider(
      vi.fn().mockResolvedValue("short-lived-access"),
    );
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ requestId: "request/safe-001" }))
      .mockResolvedValueOnce(jsonResponse({
        requestStatusPerDestination: [{
          destination: config?.destination,
          requestStatus: "SUCCESS",
          warningInfo: {
            warningCounts: [{ recordCount: "1", reason: "PROCESSING_WARNING_REASON_INTERNAL_ERROR" }],
          },
          eventsIngestionStatus: { recordCount: "1" },
        }],
      }));
    const client = createGoogleDataManagerClient({
      config,
      tokenProvider,
      fetchImpl,
      now: () => new Date("2026-09-03T02:00:00.000Z"),
    });

    await expect(client.execute(event, repository)).resolves.toEqual({
      outcome: "succeeded",
      requestId: "request/safe-001",
      requestStatus: "SUCCESS",
      destinations: [{
        requestStatus: "SUCCESS",
        recordCount: "1",
        errors: [],
        warnings: [{ recordCount: "1", reason: "PROCESSING_WARNING_REASON_INTERNAL_ERROR" }],
      }],
    });
    expect(repository.claim).toHaveBeenCalledWith({
      transactionId: event.transactionId,
      attemptedAt: "2026-09-03T02:00:00.000Z",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe(GOOGLE_DATA_MANAGER_INGEST_URL);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1].body))).toEqual({
      destinations: [config?.destination],
      events: [event],
      encoding: "HEX",
      validateOnly: false,
    });
    expect(fetchImpl.mock.calls[1][0]).toBe(
      `${GOOGLE_DATA_MANAGER_STATUS_URL}?requestId=request%2Fsafe-001`,
    );
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({ method: "GET" });
    expect(repository.markAccepted).toHaveBeenCalledWith({
      transactionId: event.transactionId,
      requestId: "request/safe-001",
      acceptedAt: "2026-09-03T02:00:00.000Z",
    });
    expect(repository.markOutcome).toHaveBeenCalledWith({
      transactionId: event.transactionId,
      requestId: "request/safe-001",
      outcome: "succeeded",
      requestStatus: "SUCCESS",
      recordedAt: "2026-09-03T02:00:00.000Z",
      destinations: [{
        requestStatus: "SUCCESS",
        recordCount: "1",
        errors: [],
        warnings: [{ recordCount: "1", reason: "PROCESSING_WARNING_REASON_INTERNAL_ERROR" }],
      }],
    });
  });

  it("retries an ingest HTTP 401 exactly once with an explicitly refreshed token", async () => {
    const repository = deliveryRepository();
    const tokenProvider = {
      getAccessToken: vi.fn().mockResolvedValue("expired-access"),
      refreshAccessToken: vi.fn().mockResolvedValue("refreshed-access"),
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "expired" }, 401))
      .mockResolvedValueOnce(jsonResponse({ requestId: "request-refresh-ingest" }))
      .mockResolvedValueOnce(jsonResponse({
        requestStatusPerDestination: [{ requestStatus: "SUCCESS" }],
      }));

    await expect(createGoogleDataManagerClient({ config, tokenProvider, fetchImpl })
      .execute(event, repository)).resolves.toMatchObject({
      outcome: "succeeded",
      requestId: "request-refresh-ingest",
    });

    expect(tokenProvider.getAccessToken).toHaveBeenCalledOnce();
    expect(tokenProvider.refreshAccessToken).toHaveBeenCalledOnce();
    expect(tokenProvider.refreshAccessToken).toHaveBeenCalledWith(
      GOOGLE_DATA_MANAGER_OAUTH_SCOPE,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.slice(0, 2).map(([url, init]) => [
      url,
      init.method,
      init.headers.Authorization,
      init.body,
    ])).toEqual([
      [GOOGLE_DATA_MANAGER_INGEST_URL, "POST", "Bearer expired-access", expect.any(String)],
      [GOOGLE_DATA_MANAGER_INGEST_URL, "POST", "Bearer refreshed-access", expect.any(String)],
    ]);
    expect(fetchImpl.mock.calls[0][1].body).toBe(fetchImpl.mock.calls[1][1].body);
  });

  it("retries a status HTTP 401 exactly once and persists 401 only after refresh retry fails", async () => {
    const repository = deliveryRepository({
      outcome: "accepted",
      requestId: "request-refresh-status",
    });
    const tokenProvider = {
      getAccessToken: vi.fn().mockResolvedValue("expired-access"),
      refreshAccessToken: vi.fn().mockResolvedValue("refreshed-access"),
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "expired" }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: "still unauthorized" }, 401));

    await expect(createGoogleDataManagerClient({ config, tokenProvider, fetchImpl })
      .execute(event, repository)).resolves.toEqual({
      outcome: "permanent_error",
      status: 401,
      requestId: "request-refresh-status",
    });

    expect(tokenProvider.refreshAccessToken).toHaveBeenCalledOnce();
    expect(tokenProvider.refreshAccessToken).toHaveBeenCalledWith(
      GOOGLE_DATA_MANAGER_OAUTH_SCOPE,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([url, init]) => [url, init.method, init.headers.Authorization])).toEqual([
      [`${GOOGLE_DATA_MANAGER_STATUS_URL}?requestId=request-refresh-status`, "GET", "Bearer expired-access"],
      [`${GOOGLE_DATA_MANAGER_STATUS_URL}?requestId=request-refresh-status`, "GET", "Bearer refreshed-access"],
    ]);
    expect(repository.markOutcome).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "permanent_error",
      httpStatus: 401,
      requestId: "request-refresh-status",
    }));
  });

  it("keeps HTTP 401 retryable when a refreshed token cannot be acquired", async () => {
    const repository = deliveryRepository();
    const tokenProvider = {
      getAccessToken: vi.fn().mockResolvedValue("expired-access"),
      refreshAccessToken: vi.fn().mockRejectedValue(new Error("temporary OAuth outage")),
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "expired" }, 401));

    await expect(createGoogleDataManagerClient({ config, tokenProvider, fetchImpl })
      .execute(event, repository)).resolves.toEqual({ outcome: "retryable_error" });

    expect(tokenProvider.refreshAccessToken).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(repository.markOutcome).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "retryable_error",
    }));
    expect(repository.markOutcome).not.toHaveBeenCalledWith(expect.objectContaining({
      outcome: "permanent_error",
      httpStatus: 401,
    }));
  });

  it("does not acquire a token or send HTTP for a transaction already durably succeeded", async () => {
    const repository = deliveryRepository({ outcome: "already_succeeded" });
    const tokenProvider = testTokenProvider(vi.fn());
    const fetchImpl = vi.fn();

    await expect(createGoogleDataManagerClient({ config, tokenProvider, fetchImpl })
      .execute(event, repository)).resolves.toEqual({
      outcome: "skipped",
      reason: "already_delivered",
    });
    expect(tokenProvider.getAccessToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(repository.markAccepted).not.toHaveBeenCalled();
  });

  it("resumes accepted status polling after 503 without sending a second ingest request", async () => {
    const repository = deliveryRepository();
    repository.claim
      .mockResolvedValueOnce({ outcome: "claimed" })
      .mockResolvedValueOnce({ outcome: "accepted", requestId: "request-resume-001" });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ requestId: "request-resume-001" }))
      .mockResolvedValueOnce(jsonResponse({ error: "temporarily unavailable" }, 503))
      .mockResolvedValueOnce(jsonResponse({
        requestStatusPerDestination: [{
          requestStatus: "SUCCESS",
          eventsIngestionStatus: { recordCount: "1" },
        }],
      }));
    const client = createGoogleDataManagerClient({
      config,
      tokenProvider: testTokenProvider(),
      fetchImpl,
    });

    await expect(client.execute(event, repository)).resolves.toEqual({
      outcome: "retryable_error",
      status: 503,
      requestId: "request-resume-001",
    });
    await expect(client.execute(event, repository)).resolves.toMatchObject({
      outcome: "succeeded",
      requestId: "request-resume-001",
      requestStatus: "SUCCESS",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      GOOGLE_DATA_MANAGER_INGEST_URL,
      `${GOOGLE_DATA_MANAGER_STATUS_URL}?requestId=request-resume-001`,
      `${GOOGLE_DATA_MANAGER_STATUS_URL}?requestId=request-resume-001`,
    ]);
    expect(fetchImpl.mock.calls.filter(([, request]) => request.method === "POST")).toHaveLength(1);
    expect(repository.markAccepted).toHaveBeenCalledOnce();
  });

  it("resumes a durable processing request with GET only", async () => {
    const repository = deliveryRepository({
      outcome: "processing",
      requestId: "request-processing-001",
    });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      requestStatusPerDestination: [{ requestStatus: "PROCESSING" }],
    }));

    await expect(createGoogleDataManagerClient({
      config,
      tokenProvider: testTokenProvider(),
      fetchImpl,
    }).execute(event, repository)).resolves.toMatchObject({
      outcome: "processing",
      requestId: "request-processing-001",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toBe(
      `${GOOGLE_DATA_MANAGER_STATUS_URL}?requestId=request-processing-001`,
    );
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: "GET" });
    expect(repository.markAccepted).not.toHaveBeenCalled();
  });

  it("preserves requestId when resumed status transport fails", async () => {
    const repository = deliveryRepository({
      outcome: "accepted",
      requestId: "request-transport-001",
    });
    const fetchImpl = vi.fn().mockRejectedValue(new Error("temporary connection reset"));

    await expect(createGoogleDataManagerClient({
      config,
      tokenProvider: testTokenProvider(),
      fetchImpl,
    }).execute(event, repository)).resolves.toEqual({
      outcome: "retryable_error",
      requestId: "request-transport-001",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toBe(
      `${GOOGLE_DATA_MANAGER_STATUS_URL}?requestId=request-transport-001`,
    );
    expect(repository.markOutcome).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "retryable_error",
      requestId: "request-transport-001",
    }));
  });

  it("preserves accepted when Google has not exposed a destination status yet", async () => {
    const repository = deliveryRepository({
      outcome: "accepted",
      requestId: "request-accepted-001",
    });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ requestStatusPerDestination: [] }));

    await expect(createGoogleDataManagerClient({
      config,
      tokenProvider: testTokenProvider(),
      fetchImpl,
    }).execute(event, repository)).resolves.toEqual({
      outcome: "accepted",
      requestId: "request-accepted-001",
      requestStatus: "REQUEST_STATUS_UNKNOWN",
      destinations: [],
    });
  });

  it("rejects malformed or privacy-unsafe runtime events before durable claim, token, or HTTP", async () => {
    const invalidEvents: readonly unknown[] = [
      { ...event, transactionId: "bad transaction" },
      { ...event, eventTimestamp: "2026-09-02 10:15:30" },
      { ...event, eventTimestamp: "2026-09-02T10:15:30+12:00" },
      { ...event, conversionValue: 0 },
      { ...event, conversionValue: Number.POSITIVE_INFINITY },
      { ...event, currency: "USD" },
      { ...event, eventSource: "EVENT_SOURCE_UNSPECIFIED" },
      { ...event, consent: { adUserData: "CONSENT_DENIED", adPersonalization: "CONSENT_DENIED" } },
      { ...event, consent: { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" } },
      {
        ...event,
        consent: {
          adUserData: "CONSENT_GRANTED",
          adPersonalization: "CONSENT_DENIED",
          rawConsent: true,
        },
      },
      { ...event, adIdentifiers: { gclid: "fake-gclid", gbraid: "fake-gbraid" } },
      { ...event, adIdentifiers: { gclid: "invalid click id" } },
      { ...event, adIdentifiers: undefined, userData: undefined },
      { ...event, rawEmail: "private@example.com" },
      {
        ...event,
        adIdentifiers: undefined,
        userData: { userIdentifiers: [{ emailAddress: "private@example.com" }] },
      },
      {
        ...event,
        adIdentifiers: undefined,
        userData: { userIdentifiers: [{ emailAddress: "A".repeat(64) }] },
      },
      {
        ...event,
        adIdentifiers: undefined,
        userData: { userIdentifiers: [{ emailAddress: "a".repeat(63) }] },
      },
      {
        ...event,
        adIdentifiers: undefined,
        userData: {
          userIdentifiers: [{ emailAddress: "a".repeat(64), phoneNumber: "b".repeat(64) }],
        },
      },
      {
        ...event,
        adIdentifiers: undefined,
        userData: {
          userIdentifiers: Array.from({ length: 11 }, () => ({ emailAddress: "a".repeat(64) })),
        },
      },
    ];
    const repository = deliveryRepository();
    const tokenProvider = testTokenProvider(vi.fn());
    const fetchImpl = vi.fn();
    const client = createGoogleDataManagerClient({ config, tokenProvider, fetchImpl });

    for (const invalidEvent of invalidEvents) {
      await expect(client.execute(invalidEvent as GoogleDataManagerEvent, repository)).resolves.toEqual({
        outcome: "permanent_error",
      });
    }
    expect(repository.claim).not.toHaveBeenCalled();
    expect(repository.markAccepted).not.toHaveBeenCalled();
    expect(repository.markOutcome).not.toHaveBeenCalled();
    expect(tokenProvider.getAccessToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([1, 10])("accepts %s valid lowercase hashed user identifiers without a click ID", async (count) => {
    const repository = deliveryRepository();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ requestId: `request-hashes-${count}` }))
      .mockResolvedValueOnce(jsonResponse({
        requestStatusPerDestination: [{ requestStatus: "PROCESSING" }],
      }));
    const hashedEvent: GoogleDataManagerEvent = {
      ...event,
      adIdentifiers: undefined,
      userData: {
        userIdentifiers: Array.from({ length: count }, (_, index) => (
          index % 2 === 0
            ? { emailAddress: "a".repeat(64) }
            : { phoneNumber: "b".repeat(64) }
        )),
      },
    };

    await expect(createGoogleDataManagerClient({
      config,
      tokenProvider: testTokenProvider(),
      fetchImpl,
    }).execute(hashedEvent, repository)).resolves.toMatchObject({
      outcome: "processing",
      requestId: `request-hashes-${count}`,
    });
    expect(repository.claim).toHaveBeenCalledOnce();
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1].body));
    expect(body.events[0].userData.userIdentifiers).toHaveLength(count);
  });

  it.each([
    ["PROCESSING", "processing"],
    ["PARTIAL_SUCCESS", "permanent_error"],
    ["FAILED", "permanent_error"],
  ] as const)("preserves destination %s as non-success outcome %s", async (requestStatus, outcome) => {
    const repository = deliveryRepository();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ requestId: `request-${requestStatus}` }))
      .mockResolvedValueOnce(jsonResponse({
        requestStatusPerDestination: [{
          destination: config?.destination,
          requestStatus,
          errorInfo: {
            errorCounts: [{
              recordCount: "2",
              reason: "PROCESSING_ERROR_REASON_INVALID_GCLID",
            }],
          },
          warningInfo: {
            warningCounts: [{
              recordCount: "1",
              reason: "PROCESSING_WARNING_REASON_INTERNAL_ERROR",
            }],
          },
          eventsIngestionStatus: { recordCount: "3" },
        }],
      }));

    const result = await createGoogleDataManagerClient({
      config,
      tokenProvider: testTokenProvider(),
      fetchImpl,
    }).execute(event, repository);
    expect(result).toMatchObject({
      outcome,
      requestId: `request-${requestStatus}`,
      requestStatus,
      destinations: [{
        requestStatus,
        recordCount: "3",
        errors: [{ recordCount: "2", reason: "PROCESSING_ERROR_REASON_INVALID_GCLID" }],
        warnings: [{ recordCount: "1", reason: "PROCESSING_WARNING_REASON_INTERNAL_ERROR" }],
      }],
    });
    expect(repository.markOutcome).toHaveBeenCalledWith(expect.objectContaining({
      transactionId: event.transactionId,
      requestId: `request-${requestStatus}`,
      outcome,
      requestStatus,
      destinations: [{
        requestStatus,
        recordCount: "3",
        errors: [{ recordCount: "2", reason: "PROCESSING_ERROR_REASON_INVALID_GCLID" }],
        warnings: [{ recordCount: "1", reason: "PROCESSING_WARNING_REASON_INTERNAL_ERROR" }],
      }],
    }));
  });

  it("treats an accepted response without a request ID as permanent failure", async () => {
    const repository = deliveryRepository();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ fieldWarnings: [] }));

    await expect(createGoogleDataManagerClient({
      config,
      tokenProvider: testTokenProvider(),
      fetchImpl,
    }).execute(event, repository)).resolves.toEqual({ outcome: "permanent_error" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(repository.markAccepted).not.toHaveBeenCalled();
    expect(repository.markOutcome).toHaveBeenCalledWith(expect.objectContaining({
      transactionId: event.transactionId,
      outcome: "permanent_error",
    }));
  });

  it.each([
    [408, "retryable_error"],
    [429, "retryable_error"],
    [500, "retryable_error"],
    [503, "retryable_error"],
    [400, "permanent_error"],
    [403, "permanent_error"],
  ] as const)("classifies HTTP %s as %s", async (status, outcome) => {
    const repository = deliveryRepository();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "provider detail" }, status));

    await expect(createGoogleDataManagerClient({
      config,
      tokenProvider: testTokenProvider(),
      fetchImpl,
    }).execute(event, repository)).resolves.toEqual({ outcome, status });
    expect(repository.markOutcome).toHaveBeenCalledWith(expect.objectContaining({
      outcome,
      httpStatus: status,
    }));
  });

  it("classifies transport failure as retryable and keeps logs to masked operational metadata", async () => {
    const rawHash = "a".repeat(64);
    const logs: unknown[] = [];
    const repository = deliveryRepository();
    const fetchImpl = vi.fn().mockRejectedValue(new Error(
      `private@example.com fake-gclid-002 short-lived-access ${rawHash}`,
    ));

    await expect(createGoogleDataManagerClient({
      config,
      tokenProvider: testTokenProvider(
        vi.fn().mockResolvedValue("short-lived-access"),
      ),
      fetchImpl,
      logger: { log: (entry) => logs.push(entry) },
    }).execute(event, repository)).resolves.toEqual({ outcome: "retryable_error" });

    expect(logs).not.toHaveLength(0);
    expect(JSON.stringify(logs)).not.toMatch(
      new RegExp(`private@example|fake-gclid|short-lived-access|${rawHash}|manual:JOB-2026-002|1234567890`),
    );
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        platform: "google_data_manager",
        statusClass: "transport_error",
        transactionId: "***26-002",
      }),
    ]));
    expect(JSON.stringify(logs)).not.toContain("7890");
  });

  it("returns retryable when token failure cannot be durably recorded and sanitizes the failure", async () => {
    const rawHash = "c".repeat(64);
    const repository = deliveryRepository();
    repository.markOutcome.mockRejectedValue(new Error(
      `private@example.com refresh-secret ${rawHash}`,
    ));
    const logs: unknown[] = [];
    const fetchImpl = vi.fn();

    await expect(createGoogleDataManagerClient({
      config,
      tokenProvider: testTokenProvider(
        vi.fn().mockRejectedValue(new Error("refresh-secret")),
      ),
      fetchImpl,
      logger: { log: (entry) => logs.push(entry) },
    }).execute(event, repository)).resolves.toEqual({ outcome: "retryable_error" });

    expect(repository.claim).toHaveBeenCalledOnce();
    expect(repository.markOutcome).toHaveBeenCalledWith(expect.objectContaining({
      transactionId: event.transactionId,
      outcome: "permanent_error",
    }));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(JSON.stringify(logs)).not.toMatch(new RegExp(`private@example|refresh-secret|${rawHash}`));
  });

  it("returns retryable with requestId when accepted or final repository writes fail", async () => {
    const markAcceptedRepository = deliveryRepository();
    markAcceptedRepository.markAccepted.mockRejectedValue(new Error("repository unavailable"));
    const acceptedFetch = vi.fn().mockResolvedValue(jsonResponse({ requestId: "request-write-001" }));

    await expect(createGoogleDataManagerClient({
      config,
      tokenProvider: testTokenProvider(),
      fetchImpl: acceptedFetch,
    }).execute(event, markAcceptedRepository)).resolves.toEqual({
      outcome: "retryable_error",
      requestId: "request-write-001",
    });

    const finalRepository = deliveryRepository({
      outcome: "processing",
      requestId: "request-write-002",
    });
    finalRepository.markOutcome.mockRejectedValue(new Error("repository unavailable"));
    const statusFetch = vi.fn().mockResolvedValue(jsonResponse({
      requestStatusPerDestination: [{ requestStatus: "SUCCESS" }],
    }));
    await expect(createGoogleDataManagerClient({
      config,
      tokenProvider: testTokenProvider(),
      fetchImpl: statusFetch,
    }).execute(event, finalRepository)).resolves.toEqual({
      outcome: "retryable_error",
      requestId: "request-write-002",
    });
  });
});
