import type { GoogleDataManagerEvent } from "@/domain/analytics/google-data-manager";
import type { GoogleDataManagerOutboxTransportResult } from "./google-data-manager-client";
import type { SafeMetaEvent } from "./meta-capi-client";
import type { ConversionDeliveryProvider, ConversionProviderResult } from "./conversion-delivery-dispatcher";
import type { ClaimedConversionDelivery } from "./drizzle-conversion-delivery-repository";
import type { ConversionProviderDiagnostics } from "@/server/db/schema";

type GoogleTransport = Readonly<{
  maximumAttemptDurationMs: number;
  ingest(event: GoogleDataManagerEvent): Promise<GoogleDataManagerOutboxTransportResult>;
  poll(requestId: string): Promise<GoogleDataManagerOutboxTransportResult>;
}>;

function httpFailure(status: number): ConversionProviderResult {
  if (status === 408) return Object.freeze({ outcome: "retryable_failed", errorCode: "http_408", errorCategory: "transport" });
  if (status === 429) return Object.freeze({ outcome: "retryable_failed", errorCode: "http_429", errorCategory: "rate_limit" });
  if (status >= 500) return Object.freeze({ outcome: "retryable_failed", errorCode: `http_${status}`, errorCategory: "provider_server" });
  if (status === 401) return Object.freeze({ outcome: "permanent_failed", errorCode: "http_401", errorCategory: "authentication" });
  if (status === 403) return Object.freeze({ outcome: "permanent_failed", errorCode: "http_403", errorCategory: "permission" });
  return Object.freeze({ outcome: "permanent_failed", errorCode: `http_${status}`, errorCategory: "invalid_event" });
}

function googleEvent(delivery: ClaimedConversionDelivery): GoogleDataManagerEvent | null {
  const consent = delivery.consentSnapshot;
  const attribution = delivery.attributionSnapshot;
  const userData = delivery.userDataSnapshot;
  if ("redacted" in consent || "redacted" in attribution || "redacted" in userData
    || consent.adUserData !== "CONSENT_GRANTED"
    || consent.adPersonalization !== "CONSENT_DENIED"
    || attribution.source !== "google") return null;
  const adIdentifiers = {
    ...(attribution.gclid ? { gclid: attribution.gclid } : {}),
    ...(attribution.gbraid ? { gbraid: attribution.gbraid } : {}),
    ...(attribution.wbraid ? { wbraid: attribution.wbraid } : {}),
  };
  const userIdentifiers = [
    ...(userData.hashedEmail ? [{ emailAddress: userData.hashedEmail }] : []),
    ...(userData.hashedPhone ? [{ phoneNumber: userData.hashedPhone }] : []),
  ];
  return Object.freeze({
    transactionId: delivery.transactionId,
    eventTimestamp: delivery.eventOccurredAt.toISOString(),
    conversionValue: delivery.valueMinor / 100,
    currency: delivery.currency,
    eventSource: delivery.eventSource,
    ...(Object.keys(adIdentifiers).length ? { adIdentifiers: Object.freeze(adIdentifiers) } : {}),
    ...(userIdentifiers.length ? { userData: Object.freeze({ userIdentifiers: Object.freeze(userIdentifiers) }) } : {}),
    consent: Object.freeze({
      adUserData: "CONSENT_GRANTED" as const,
      adPersonalization: "CONSENT_DENIED" as const,
    }),
  });
}

function googleResult(result: GoogleDataManagerOutboxTransportResult): ConversionProviderResult {
  if (result.outcome === "accepted") return result;
  if (result.outcome === "configuration_error") {
    return Object.freeze({ outcome: "permanent_failed", errorCode: "configuration_error", errorCategory: "configuration" });
  }
  if (result.outcome === "transport_error") {
    return Object.freeze({ outcome: "retryable_failed", errorCode: "transport_error", errorCategory: "transport" });
  }
  if (result.outcome === "http_error") return httpFailure(result.status);
  const diagnostics: ConversionProviderDiagnostics = Object.freeze({
    version: 1,
    requestStatus: result.requestStatus,
    destinations: result.destinations,
  });
  const hasRetryableFailure = result.destinations.some((destination) =>
    destination.errors.some(({ reason }) => /(?:INTERNAL_ERROR|UNAVAILABLE|DEADLINE_EXCEEDED|RESOURCE_EXHAUSTED|RATE_LIMIT|TEMPORAR)/.test(reason)),
  );
  switch (result.requestStatus) {
    case "SUCCESS": return Object.freeze({ outcome: "succeeded", diagnostics });
    case "PROCESSING":
    case "REQUEST_STATUS_UNKNOWN": return Object.freeze({ outcome: "processing", diagnostics });
    case "PARTIAL_SUCCESS": return Object.freeze({ outcome: "permanent_failed", errorCode: "partial_success", errorCategory: "partial_success", diagnostics });
    case "FAILURE": return hasRetryableFailure
      ? Object.freeze({ outcome: "retryable_failed", errorCode: "google_failure_retryable", errorCategory: "provider_server", diagnostics })
      : Object.freeze({ outcome: "permanent_failed", errorCode: "google_failure", errorCategory: "invalid_event", diagnostics });
  }
}

export function createGoogleDataManagerDeliveryProvider(
  transport: GoogleTransport,
): ConversionDeliveryProvider {
  return Object.freeze({
    maximumAttemptDurationMs: transport.maximumAttemptDurationMs,
    async deliver(delivery) {
      if (delivery.platform !== "google") {
        return Object.freeze({ outcome: "permanent_failed", errorCode: "platform_mismatch", errorCategory: "configuration" });
      }
      if (delivery.work === "poll") {
        return delivery.requestId
          ? googleResult(await transport.poll(delivery.requestId))
          : Object.freeze({ outcome: "permanent_failed", errorCode: "request_id_missing", errorCategory: "configuration" });
      }
      const event = googleEvent(delivery);
      return event
        ? googleResult(await transport.ingest(event))
        : Object.freeze({ outcome: "permanent_failed", errorCode: "snapshot_invalid", errorCategory: "invalid_event" });
    },
  });
}

function metaEvent(delivery: ClaimedConversionDelivery): SafeMetaEvent | null {
  const consent = delivery.consentSnapshot;
  const attribution = delivery.attributionSnapshot;
  const userData = delivery.userDataSnapshot;
  if ("redacted" in consent || "redacted" in attribution || "redacted" in userData
    || attribution.source !== "meta") return null;
  const base = {
    name: "Purchase" as const,
    eventId: `purchase:manual:${delivery.jobId}`,
    eventTime: Math.floor(delivery.eventOccurredAt.getTime() / 1_000),
    currency: delivery.currency,
    value: delivery.valueMinor / 100,
    ...(attribution.fbp ? { fbp: attribution.fbp } : {}),
    ...(attribution.fbc ? { fbc: attribution.fbc } : {}),
    ...(userData.hashedEmail ? { hashedEmail: userData.hashedEmail } : {}),
    ...(userData.hashedPhone ? { hashedPhone: userData.hashedPhone } : {}),
  };
  return delivery.eventSource === "MESSAGE"
    ? Object.freeze({ ...base, actionSource: "business_messaging" as const })
    : Object.freeze({ ...base, actionSource: "website" as const, sourceUrl: "https://rnrgallery.com/contact" });
}

export function createMetaCapiDeliveryProvider(input: Readonly<{
  send(event: SafeMetaEvent): Promise<"disabled" | "sent" | "failed">;
  maximumAttemptDurationMs: number;
}>): ConversionDeliveryProvider {
  return Object.freeze({
    maximumAttemptDurationMs: input.maximumAttemptDurationMs,
    async deliver(delivery) {
      if (delivery.platform !== "meta") {
        return Object.freeze({ outcome: "permanent_failed", errorCode: "platform_mismatch", errorCategory: "configuration" });
      }
      if (delivery.work === "poll") {
        return Object.freeze({ outcome: "permanent_failed", errorCode: "meta_poll_not_supported", errorCategory: "configuration" });
      }
      const event = metaEvent(delivery);
      if (!event) return Object.freeze({ outcome: "permanent_failed", errorCode: "snapshot_invalid", errorCategory: "invalid_event" });
      const result = await input.send(event);
      if (result === "sent") return Object.freeze({ outcome: "succeeded" });
      if (result === "disabled") return Object.freeze({ outcome: "permanent_failed", errorCode: "provider_disabled", errorCategory: "configuration" });
      return Object.freeze({ outcome: "retryable_failed", errorCode: "provider_failed", errorCategory: "provider_server" });
    },
  });
}
