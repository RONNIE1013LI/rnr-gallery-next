import type {
  GoogleDataManagerDeliveryResult,
  GoogleDataManagerEvent,
  GoogleUserIdentifier,
} from "@/domain/analytics/google-data-manager";

export const GOOGLE_DATA_MANAGER_INGEST_URL =
  "https://datamanager.googleapis.com/v1/events:ingest";
export const GOOGLE_DATA_MANAGER_STATUS_URL =
  "https://datamanager.googleapis.com/v1/requestStatus:retrieve";
export const GOOGLE_DATA_MANAGER_OAUTH_SCOPE =
  "https://www.googleapis.com/auth/datamanager";

type GoogleAdsAccount = Readonly<{
  accountType: "GOOGLE_ADS";
  accountId: string;
}>;

export type GoogleDataManagerDestination = Readonly<{
  operatingAccount: GoogleAdsAccount;
  productDestinationId: string;
  loginAccount?: GoogleAdsAccount;
}>;

export type GoogleDataManagerDestinationConfig = Readonly<{
  destination: GoogleDataManagerDestination;
}>;

type DeliveryOutcome = Extract<
  GoogleDataManagerDeliveryResult,
  { outcome: "accepted" | "processing" | "succeeded" | "retryable_error" | "permanent_error" }
>["outcome"];

export type GoogleDataManagerDeliveryClaim =
  | Readonly<{ outcome: "claimed" }>
  | Readonly<{ outcome: "already_succeeded" }>
  | Readonly<{ outcome: "accepted" | "processing"; requestId: string }>;

export type GoogleDataManagerDeliveryRepository = Readonly<{
  claim(input: Readonly<{
    transactionId: string;
    attemptedAt: string;
  }>): Promise<GoogleDataManagerDeliveryClaim>;
  markAccepted(input: Readonly<{
    transactionId: string;
    requestId: string;
    acceptedAt: string;
  }>): Promise<void>;
  markOutcome(input: Readonly<{
    transactionId: string;
    outcome: DeliveryOutcome;
    recordedAt: string;
    requestId?: string;
    requestStatus?: GoogleDataManagerRequestStatus;
    destinations?: readonly GoogleDataManagerDestinationStatus[];
    httpStatus?: number;
  }>): Promise<void>;
}>;

export type GoogleDataManagerTokenProvider = Readonly<{
  getAccessToken(scope: typeof GOOGLE_DATA_MANAGER_OAUTH_SCOPE): Promise<string>;
  refreshAccessToken(scope: typeof GOOGLE_DATA_MANAGER_OAUTH_SCOPE): Promise<string>;
}>;

export type GoogleDataManagerSafeLogEntry = Readonly<{
  platform: "google_data_manager";
  statusClass: "blocked" | "configuration_error" | "transport_error" | "http_error" | "accepted" | "status";
  transactionId?: string;
  requestId?: string;
  requestStatus?: GoogleDataManagerRequestStatus;
  httpStatus?: number;
}>;

export type GoogleDataManagerSafeLogger = Readonly<{
  log(entry: GoogleDataManagerSafeLogEntry): void;
}>;

export type GoogleDataManagerRequestStatus =
  | "REQUEST_STATUS_UNKNOWN"
  | "SUCCESS"
  | "PROCESSING"
  | "FAILED"
  | "PARTIAL_SUCCESS";

export type GoogleDataManagerStatusCount = Readonly<{
  recordCount: string;
  reason: string;
}>;

export type GoogleDataManagerDestinationStatus = Readonly<{
  requestStatus: GoogleDataManagerRequestStatus;
  recordCount?: string;
  errors: readonly GoogleDataManagerStatusCount[];
  warnings: readonly GoogleDataManagerStatusCount[];
}>;

export type GoogleDataManagerFieldWarning = Readonly<{
  reason: string;
  field?: string;
}>;

export type GoogleDataManagerClientResult =
  | Extract<GoogleDataManagerDeliveryResult, { outcome: "blocked_no_durable_store" | "skipped" }>
  | Readonly<{
      outcome: "validate_only_success";
      requestId?: string;
      fieldWarnings: readonly GoogleDataManagerFieldWarning[];
    }>
  | Readonly<{
      outcome: "accepted" | "processing" | "succeeded";
      requestId: string;
      requestStatus: GoogleDataManagerRequestStatus;
      destinations: readonly GoogleDataManagerDestinationStatus[];
    }>
  | Readonly<{
      outcome: "retryable_error" | "permanent_error";
      status?: number;
      requestId?: string;
      requestStatus?: GoogleDataManagerRequestStatus;
      destinations?: readonly GoogleDataManagerDestinationStatus[];
    }>;

export type GoogleDataManagerOutboxTransportResult =
  | Readonly<{ outcome: "accepted"; requestId: string }>
  | Readonly<{
      outcome: "status";
      requestStatus: GoogleDataManagerRequestStatus;
      destinations: readonly GoogleDataManagerDestinationStatus[];
    }>
  | Readonly<{ outcome: "transport_error" }>
  | Readonly<{ outcome: "http_error"; status: number }>
  | Readonly<{ outcome: "configuration_error" }>;

type Environment = Readonly<Record<string, string | undefined>>;

const ACCOUNT_ID_PATTERN = /^\d{6,20}$/;
const DESTINATION_ID_PATTERN = /^\d{1,20}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._~:/-]{1,256}$/;
const ENUM_PATTERN = /^[A-Z][A-Z0-9_]{0,126}$/;
const FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_.\[\]]{0,255}$/;
const COUNT_PATTERN = /^\d+$/;
const TRANSACTION_ID_PATTERN = /^[A-Za-z0-9:_-]{3,100}$/;
const CLICK_IDENTIFIER_PATTERN = /^[A-Za-z0-9._~-]{1,200}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const RFC3339_UTC_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/;
const EVENT_KEYS = new Set([
  "transactionId",
  "eventTimestamp",
  "conversionValue",
  "currency",
  "eventSource",
  "adIdentifiers",
  "userData",
  "consent",
]);
const CLICK_KEYS = new Set(["gclid", "gbraid", "wbraid"]);
const USER_IDENTIFIER_KEYS = new Set(["emailAddress", "phoneNumber"]);

function normalizeId(value: string | undefined, pattern: RegExp): string | null {
  const normalized = value?.trim().replace(/[\s-]/g, "") ?? "";
  return pattern.test(normalized) ? normalized : null;
}

export function parseGoogleDataManagerDestinationConfig(
  env: Environment,
): GoogleDataManagerDestinationConfig | null {
  const operatingAccountId = normalizeId(
    env.GOOGLE_DATA_MANAGER_OPERATING_ACCOUNT_ID,
    ACCOUNT_ID_PATTERN,
  );
  const productDestinationId = normalizeId(
    env.GOOGLE_DATA_MANAGER_PRODUCT_DESTINATION_ID,
    DESTINATION_ID_PATTERN,
  );
  const loginAccountType = env.GOOGLE_DATA_MANAGER_LOGIN_ACCOUNT_TYPE?.trim() ?? "";
  const loginAccountIdInput = env.GOOGLE_DATA_MANAGER_LOGIN_ACCOUNT_ID?.trim() ?? "";
  const linkedAccountConfigured = Boolean(
    env.GOOGLE_DATA_MANAGER_LINKED_ACCOUNT_ID?.trim()
      || env.GOOGLE_DATA_MANAGER_LINKED_ACCOUNT_TYPE?.trim(),
  );
  if (!operatingAccountId || !productDestinationId || linkedAccountConfigured) return null;
  if (Boolean(loginAccountType) !== Boolean(loginAccountIdInput)) return null;
  const loginAccountId = loginAccountIdInput
    ? normalizeId(loginAccountIdInput, ACCOUNT_ID_PATTERN)
    : null;
  if (loginAccountType && (loginAccountType !== "GOOGLE_ADS" || !loginAccountId)) return null;
  return Object.freeze({
    destination: Object.freeze({
      operatingAccount: Object.freeze({ accountType: "GOOGLE_ADS", accountId: operatingAccountId }),
      productDestinationId,
      ...(loginAccountId ? {
        loginAccount: Object.freeze({ accountType: "GOOGLE_ADS", accountId: loginAccountId }),
      } : {}),
    }),
  });
}

function isDeliveryRepository(value: unknown): value is GoogleDataManagerDeliveryRepository {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GoogleDataManagerDeliveryRepository>;
  return typeof candidate.claim === "function"
    && typeof candidate.markAccepted === "function"
    && typeof candidate.markOutcome === "function";
}

function safeRequestId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return REQUEST_ID_PATTERN.test(normalized) ? normalized : null;
}

function safeEnum(value: unknown, fallback: string): string {
  return typeof value === "string" && ENUM_PATTERN.test(value) ? value : fallback;
}

function safeCount(value: unknown): string | undefined {
  return typeof value === "string" && COUNT_PATTERN.test(value) ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isValidUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = RFC3339_UTC_PATTERN.exec(value);
  if (!match) return false;
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime())
    && timestamp.getUTCFullYear() === Number(match[1])
    && timestamp.getUTCMonth() + 1 === Number(match[2])
    && timestamp.getUTCDate() === Number(match[3])
    && timestamp.getUTCHours() === Number(match[4])
    && timestamp.getUTCMinutes() === Number(match[5])
    && timestamp.getUTCSeconds() === Number(match[6]);
}

function isValidRuntimeEvent(value: unknown): value is GoogleDataManagerEvent {
  const event = objectValue(value);
  if (!event || !hasOnlyKeys(event, EVENT_KEYS)
    || typeof event.transactionId !== "string"
    || !TRANSACTION_ID_PATTERN.test(event.transactionId)
    || !isValidUtcTimestamp(event.eventTimestamp)
    || typeof event.conversionValue !== "number"
    || !Number.isFinite(event.conversionValue)
    || event.conversionValue <= 0
    || (event.currency !== "NZD" && event.currency !== "AUD")
    || typeof event.eventSource !== "string"
    || !["WEB", "MESSAGE", "PHONE", "OTHER"].includes(event.eventSource)) return false;

  const consent = objectValue(event.consent);
  if (!consent || Object.keys(consent).length !== 2
    || consent.adUserData !== "CONSENT_GRANTED"
    || consent.adPersonalization !== "CONSENT_DENIED") return false;

  let clickCount = 0;
  if (event.adIdentifiers !== undefined) {
    const adIdentifiers = objectValue(event.adIdentifiers);
    if (!adIdentifiers || !hasOnlyKeys(adIdentifiers, CLICK_KEYS)) return false;
    const entries = Object.entries(adIdentifiers);
    if (entries.length !== 1 || typeof entries[0][1] !== "string"
      || !CLICK_IDENTIFIER_PATTERN.test(entries[0][1])) return false;
    clickCount = 1;
  }

  let hashCount = 0;
  if (event.userData !== undefined) {
    const userData = objectValue(event.userData);
    if (!userData || Object.keys(userData).length !== 1
      || !Array.isArray(userData.userIdentifiers)
      || userData.userIdentifiers.length < 1
      || userData.userIdentifiers.length > 10) return false;
    for (const rawIdentifier of userData.userIdentifiers) {
      const identifier = objectValue(rawIdentifier);
      if (!identifier || !hasOnlyKeys(identifier, USER_IDENTIFIER_KEYS)) return false;
      const entries = Object.entries(identifier);
      if (entries.length !== 1 || typeof entries[0][1] !== "string"
        || !HASH_PATTERN.test(entries[0][1])) return false;
      hashCount += 1;
    }
  }
  return clickCount === 1 || hashCount >= 1;
}

async function responseJson(response: Response): Promise<Record<string, unknown> | null> {
  if (!/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "")) return null;
  try {
    return objectValue(await response.json());
  } catch {
    return null;
  }
}

function parseCounts(value: unknown, key: "errorCounts" | "warningCounts"): readonly GoogleDataManagerStatusCount[] {
  const container = objectValue(value);
  const rows = container?.[key];
  if (!Array.isArray(rows)) return Object.freeze([]);
  return Object.freeze(rows.flatMap((row) => {
    const item = objectValue(row);
    const recordCount = safeCount(item?.recordCount);
    if (!recordCount) return [];
    return [Object.freeze({
      recordCount,
      reason: safeEnum(item?.reason, key === "errorCounts"
        ? "PROCESSING_ERROR_REASON_UNSPECIFIED"
        : "PROCESSING_WARNING_REASON_UNSPECIFIED"),
    })];
  }));
}

function requestStatus(value: unknown): GoogleDataManagerRequestStatus {
  return value === "SUCCESS" || value === "PROCESSING" || value === "FAILED"
    || value === "PARTIAL_SUCCESS" || value === "REQUEST_STATUS_UNKNOWN"
    ? value
    : "REQUEST_STATUS_UNKNOWN";
}

function parseDestinationStatuses(value: unknown): readonly GoogleDataManagerDestinationStatus[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value.flatMap((row) => {
    const item = objectValue(row);
    if (!item) return [];
    const eventsStatus = objectValue(item.eventsIngestionStatus);
    const recordCount = safeCount(eventsStatus?.recordCount);
    return [Object.freeze({
      requestStatus: requestStatus(item.requestStatus),
      ...(recordCount ? { recordCount } : {}),
      errors: parseCounts(item.errorInfo, "errorCounts"),
      warnings: parseCounts(item.warningInfo, "warningCounts"),
    })];
  }));
}

function overallStatus(
  destinations: readonly GoogleDataManagerDestinationStatus[],
): GoogleDataManagerRequestStatus {
  if (destinations.length === 0) return "REQUEST_STATUS_UNKNOWN";
  if (destinations.every((destination) => destination.requestStatus === "SUCCESS")) return "SUCCESS";
  if (destinations.some((destination) => destination.requestStatus === "FAILED")) return "FAILED";
  if (destinations.some((destination) => destination.requestStatus === "PARTIAL_SUCCESS")) {
    return "PARTIAL_SUCCESS";
  }
  if (destinations.some((destination) => destination.requestStatus === "PROCESSING")) return "PROCESSING";
  return "REQUEST_STATUS_UNKNOWN";
}

function parseFieldWarnings(value: unknown): readonly GoogleDataManagerFieldWarning[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value.flatMap((row) => {
    const item = objectValue(row);
    if (!item) return [];
    const field = typeof item.field === "string" && FIELD_PATTERN.test(item.field)
      ? item.field
      : undefined;
    return [Object.freeze({
      reason: safeEnum(item.reason, "WARNING_REASON_UNSPECIFIED"),
      ...(field ? { field } : {}),
    })];
  }));
}

function classifyHttpStatus(status: number): "retryable_error" | "permanent_error" {
  return status === 408 || status === 429 || status >= 500
    ? "retryable_error"
    : "permanent_error";
}

function masked(value: string, suffixLength: number): string {
  return value.length > suffixLength ? `***${value.slice(-suffixLength)}` : "***";
}

function syntheticEvent(at: Date): GoogleDataManagerEvent {
  return Object.freeze({
    transactionId: "diagnostic:synthetic",
    eventTimestamp: at.toISOString(),
    conversionValue: 1,
    currency: "NZD",
    eventSource: "OTHER",
    adIdentifiers: Object.freeze({ gclid: "synthetic-diagnostic-gclid" }),
    consent: Object.freeze({
      adUserData: "CONSENT_GRANTED",
      adPersonalization: "CONSENT_DENIED",
    }),
  });
}

function safeEventPayload(event: GoogleDataManagerEvent): GoogleDataManagerEvent {
  const adIdentifiers = event.adIdentifiers
    ? Object.freeze({
        ...(event.adIdentifiers.gclid ? { gclid: event.adIdentifiers.gclid } : {}),
        ...(event.adIdentifiers.gbraid ? { gbraid: event.adIdentifiers.gbraid } : {}),
        ...(event.adIdentifiers.wbraid ? { wbraid: event.adIdentifiers.wbraid } : {}),
      })
    : undefined;
  const userIdentifiers: GoogleUserIdentifier[] = [];
  for (const identifier of event.userData?.userIdentifiers ?? []) {
    if ("emailAddress" in identifier) {
      userIdentifiers.push(Object.freeze({ emailAddress: identifier.emailAddress }));
    } else if ("phoneNumber" in identifier) {
      userIdentifiers.push(Object.freeze({ phoneNumber: identifier.phoneNumber }));
    }
  }
  return Object.freeze({
    transactionId: event.transactionId,
    eventTimestamp: event.eventTimestamp,
    conversionValue: event.conversionValue,
    currency: event.currency,
    eventSource: event.eventSource,
    ...(adIdentifiers && Object.keys(adIdentifiers).length ? { adIdentifiers } : {}),
    ...(userIdentifiers.length ? {
      userData: Object.freeze({ userIdentifiers: Object.freeze(userIdentifiers) }),
    } : {}),
    consent: Object.freeze({
      adUserData: event.consent.adUserData,
      adPersonalization: event.consent.adPersonalization,
    }),
  });
}

const silentLogger: GoogleDataManagerSafeLogger = Object.freeze({ log: () => undefined });

export function createGoogleDataManagerClient({
  config,
  tokenProvider,
  fetchImpl,
  now = () => new Date(),
  logger = silentLogger,
  requestTimeoutMs = 30_000,
}: Readonly<{
  config: GoogleDataManagerDestinationConfig | null;
  tokenProvider: GoogleDataManagerTokenProvider;
  fetchImpl: typeof fetch;
  now?: () => Date;
  logger?: GoogleDataManagerSafeLogger;
  requestTimeoutMs?: number;
}>) {
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs >= 60_000) {
    throw new Error("Google Data Manager operation timeout must be below the minimum delivery lease");
  }
  async function withOperationDeadline<T>(operation: (signal: AbortSignal) => Promise<T>) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      return await Promise.race([
        operation(controller.signal),
        new Promise<never>((_resolve, reject) => controller.signal.addEventListener(
          "abort",
          () => reject(new Error("google_data_manager_timeout")),
          { once: true },
        )),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }
  function log(
    statusClass: GoogleDataManagerSafeLogEntry["statusClass"],
    details: Readonly<{
      transactionId?: string;
      requestId?: string;
      requestStatus?: GoogleDataManagerRequestStatus;
      httpStatus?: number;
    }> = {},
  ) {
    logger.log(Object.freeze({
      platform: "google_data_manager",
      statusClass,
      ...(details.transactionId ? { transactionId: masked(details.transactionId, 6) } : {}),
      ...(details.requestId ? { requestId: masked(details.requestId, 8) } : {}),
      ...(details.requestStatus ? { requestStatus: details.requestStatus } : {}),
      ...(details.httpStatus ? { httpStatus: details.httpStatus } : {}),
    }));
  }

  async function accessToken(): Promise<string | null> {
    try {
      const token = (await tokenProvider.getAccessToken(GOOGLE_DATA_MANAGER_OAUTH_SCOPE)).trim();
      return token || null;
    } catch {
      return null;
    }
  }

  async function refreshedAccessToken(): Promise<string | null> {
    try {
      const token = (await tokenProvider.refreshAccessToken(GOOGLE_DATA_MANAGER_OAUTH_SCOPE)).trim();
      return token || null;
    } catch {
      return null;
    }
  }

  function request(token: string, method: "POST" | "GET", body?: unknown): RequestInit {
    return {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
    };
  }

  async function authenticatedFetch(
    url: string,
    token: string,
    method: "POST" | "GET",
    body?: unknown,
    operationSignal?: AbortSignal,
  ): Promise<Readonly<{ response: Response; token: string }>> {
    const controller = operationSignal ? null : new AbortController();
    const signal = operationSignal ?? controller!.signal;
    const timeout = controller ? setTimeout(() => controller.abort(), requestTimeoutMs) : null;
    const requestWithSignal = (accessTokenValue: string) => ({
      ...request(accessTokenValue, method, body),
      signal,
    });
    try {
      let response = await fetchImpl(url, requestWithSignal(token));
      if (response.status !== 401) return Object.freeze({ response, token });

      const refreshedToken = await refreshedAccessToken();
      if (!refreshedToken) throw new Error("google_data_manager_token_refresh_failed");
      signal.throwIfAborted();
      response = await fetchImpl(url, requestWithSignal(refreshedToken));
      return Object.freeze({ response, token: refreshedToken });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function markOutcome(
    repository: GoogleDataManagerDeliveryRepository,
    input: Omit<Parameters<GoogleDataManagerDeliveryRepository["markOutcome"]>[0], "recordedAt">,
  ) {
    await repository.markOutcome({ ...input, recordedAt: now().toISOString() });
  }

  return Object.freeze({
    maximumAttemptDurationMs: requestTimeoutMs,
    async ingest(event: GoogleDataManagerEvent): Promise<GoogleDataManagerOutboxTransportResult> {
      if (!config || !isValidRuntimeEvent(event)) {
        log("configuration_error", { transactionId: event.transactionId });
        return Object.freeze({ outcome: "configuration_error" });
      }
      try {
        return await withOperationDeadline(async (signal) => {
          const token = await accessToken();
          if (!token) {
            log("configuration_error", { transactionId: event.transactionId });
            return Object.freeze({ outcome: "configuration_error" as const });
          }
          signal.throwIfAborted();
          const result = await authenticatedFetch(GOOGLE_DATA_MANAGER_INGEST_URL, token, "POST", {
            destinations: [config.destination],
            events: [safeEventPayload(event)],
            encoding: "HEX",
            validateOnly: false,
          }, signal);
          if (!result.response.ok) {
            log("http_error", {
              transactionId: event.transactionId,
              httpStatus: result.response.status,
            });
            return Object.freeze({ outcome: "http_error" as const, status: result.response.status });
          }
          const body = await responseJson(result.response);
          const requestId = safeRequestId(body?.requestId);
          if (!requestId) {
            log("configuration_error", { transactionId: event.transactionId });
            return Object.freeze({ outcome: "configuration_error" as const });
          }
          log("accepted", { transactionId: event.transactionId, requestId });
          return Object.freeze({ outcome: "accepted" as const, requestId });
        });
      } catch {
        log("transport_error", { transactionId: event.transactionId });
        return Object.freeze({ outcome: "transport_error" });
      }
    },

    async poll(requestIdInput: string): Promise<GoogleDataManagerOutboxTransportResult> {
      const requestId = safeRequestId(requestIdInput);
      if (!config || !requestId) {
        log("configuration_error");
        return Object.freeze({ outcome: "configuration_error" });
      }
      try {
        return await withOperationDeadline(async (signal) => {
          const token = await accessToken();
          if (!token) {
            log("configuration_error", { requestId });
            return Object.freeze({ outcome: "configuration_error" as const });
          }
          signal.throwIfAborted();
          const result = await authenticatedFetch(
            `${GOOGLE_DATA_MANAGER_STATUS_URL}?requestId=${encodeURIComponent(requestId)}`,
            token,
            "GET",
            undefined,
            signal,
          );
          if (!result.response.ok) {
            log("http_error", { requestId, httpStatus: result.response.status });
            return Object.freeze({ outcome: "http_error" as const, status: result.response.status });
          }
          const body = await responseJson(result.response);
          const destinations = parseDestinationStatuses(body?.requestStatusPerDestination);
          const requestStatus = overallStatus(destinations);
          log("status", { requestId, requestStatus });
          return Object.freeze({ outcome: "status" as const, requestStatus, destinations });
        });
      } catch {
        log("transport_error", { requestId });
        return Object.freeze({ outcome: "transport_error" });
      }
    },

    async validateSynthetic(): Promise<GoogleDataManagerClientResult> {
      if (!config) {
        log("configuration_error");
        return Object.freeze({ outcome: "permanent_error" });
      }
      const token = await accessToken();
      if (!token) {
        log("configuration_error");
        return Object.freeze({ outcome: "permanent_error" });
      }
      try {
        const result = await authenticatedFetch(GOOGLE_DATA_MANAGER_INGEST_URL, token, "POST", {
          destinations: [config.destination],
          events: [syntheticEvent(now())],
          encoding: "HEX",
          validateOnly: true,
        });
        const response = result.response;
        if (!response.ok) {
          log("http_error", { httpStatus: response.status });
          return Object.freeze({ outcome: classifyHttpStatus(response.status), status: response.status });
        }
        const parsed = await responseJson(response);
        if (!parsed) return Object.freeze({ outcome: "permanent_error" });
        const requestId = safeRequestId(parsed.requestId);
        return Object.freeze({
          outcome: "validate_only_success",
          ...(requestId ? { requestId } : {}),
          fieldWarnings: parseFieldWarnings(parsed.fieldWarnings),
        });
      } catch {
        log("transport_error");
        return Object.freeze({ outcome: "retryable_error" });
      }
    },

    async execute(
      event: GoogleDataManagerEvent,
      repository?: GoogleDataManagerDeliveryRepository,
    ): Promise<GoogleDataManagerClientResult> {
      if (!isValidRuntimeEvent(event)) {
        log("configuration_error");
        return Object.freeze({ outcome: "permanent_error" });
      }
      if (!isDeliveryRepository(repository)) {
        log("blocked", { transactionId: event.transactionId });
        return Object.freeze({ outcome: "blocked_no_durable_store" });
      }
      if (!config) {
        log("configuration_error", { transactionId: event.transactionId });
        return Object.freeze({ outcome: "permanent_error" });
      }

      const attemptedAt = now().toISOString();
      let claim: GoogleDataManagerDeliveryClaim;
      try {
        claim = await repository.claim({ transactionId: event.transactionId, attemptedAt });
      } catch {
        log("transport_error", { transactionId: event.transactionId });
        return Object.freeze({ outcome: "retryable_error" });
      }
      if (claim.outcome === "already_succeeded") {
        return Object.freeze({ outcome: "skipped", reason: "already_delivered" });
      }
      const resumableRequestId = claim.outcome === "accepted" || claim.outcome === "processing"
        ? safeRequestId(claim.requestId)
        : null;
      if (claim.outcome !== "claimed" && !resumableRequestId) {
        log("configuration_error", { transactionId: event.transactionId });
        return Object.freeze({ outcome: "permanent_error" });
      }

      let token = await accessToken();
      if (!token) {
        const result = Object.freeze({
          outcome: "permanent_error" as const,
          ...(resumableRequestId ? { requestId: resumableRequestId } : {}),
        });
        try {
          await markOutcome(repository, { transactionId: event.transactionId, ...result });
        } catch {
          const outcome = "retryable_error" as const;
          log("transport_error", {
            transactionId: event.transactionId,
            ...(resumableRequestId ? { requestId: resumableRequestId } : {}),
          });
          return Object.freeze({
            outcome,
            ...(resumableRequestId ? { requestId: resumableRequestId } : {}),
          });
        }
        log("configuration_error", { transactionId: event.transactionId });
        return result;
      }

      let requestId = resumableRequestId ?? undefined;
      try {
        if (!requestId) {
          const ingestResult = await authenticatedFetch(GOOGLE_DATA_MANAGER_INGEST_URL, token, "POST", {
            destinations: [config.destination],
            events: [safeEventPayload(event)],
            encoding: "HEX",
            validateOnly: false,
          });
          const ingestResponse = ingestResult.response;
          token = ingestResult.token;
          if (!ingestResponse.ok) {
            const outcome = classifyHttpStatus(ingestResponse.status);
            await markOutcome(repository, {
              transactionId: event.transactionId,
              outcome,
              httpStatus: ingestResponse.status,
            });
            log("http_error", { transactionId: event.transactionId, httpStatus: ingestResponse.status });
            return Object.freeze({ outcome, status: ingestResponse.status });
          }

          const ingestBody = await responseJson(ingestResponse);
          requestId = safeRequestId(ingestBody?.requestId) ?? undefined;
          if (!requestId) {
            const outcome = "permanent_error" as const;
            await markOutcome(repository, { transactionId: event.transactionId, outcome });
            log("configuration_error", { transactionId: event.transactionId });
            return Object.freeze({ outcome });
          }
          await repository.markAccepted({
            transactionId: event.transactionId,
            requestId,
            acceptedAt: now().toISOString(),
          });
          log("accepted", { transactionId: event.transactionId, requestId });
        }

        const statusResult = await authenticatedFetch(
          `${GOOGLE_DATA_MANAGER_STATUS_URL}?requestId=${encodeURIComponent(requestId)}`,
          token,
          "GET",
        );
        const statusResponse = statusResult.response;
        if (!statusResponse.ok) {
          const outcome = classifyHttpStatus(statusResponse.status);
          await markOutcome(repository, {
            transactionId: event.transactionId,
            requestId,
            outcome,
            httpStatus: statusResponse.status,
          });
          log("http_error", {
            transactionId: event.transactionId,
            requestId,
            httpStatus: statusResponse.status,
          });
          return Object.freeze({ outcome, status: statusResponse.status, requestId });
        }

        const statusBody = await responseJson(statusResponse);
        const destinations = parseDestinationStatuses(statusBody?.requestStatusPerDestination);
        const currentStatus = overallStatus(destinations);
        const outcome = currentStatus === "SUCCESS"
          ? "succeeded" as const
          : currentStatus === "PROCESSING"
            ? "processing" as const
            : currentStatus === "REQUEST_STATUS_UNKNOWN"
              ? "accepted" as const
              : "permanent_error" as const;
        await markOutcome(repository, {
          transactionId: event.transactionId,
          requestId,
          outcome,
          requestStatus: currentStatus,
          destinations,
        });
        log("status", {
          transactionId: event.transactionId,
          requestId,
          requestStatus: currentStatus,
        });
        return Object.freeze({
          outcome,
          requestId,
          requestStatus: currentStatus,
          destinations,
        });
      } catch {
        const outcome = "retryable_error" as const;
        try {
          await markOutcome(repository, {
            transactionId: event.transactionId,
            outcome,
            ...(requestId ? { requestId } : {}),
          });
        } catch {
          // The caller receives a retryable result when durable state cannot be updated.
        }
        log("transport_error", { transactionId: event.transactionId, ...(requestId ? { requestId } : {}) });
        return Object.freeze({ outcome, ...(requestId ? { requestId } : {}) });
      }
    },
  });
}
