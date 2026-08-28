import type {
  ConversionErrorCategory,
  ConversionPlatform,
  ConversionProviderDiagnostics,
} from "@/server/db/schema";
import type { ClaimedConversionDelivery } from "./drizzle-conversion-delivery-repository";

export type ConversionProviderResult =
  | Readonly<{ outcome: "accepted"; requestId: string }>
  | Readonly<{ outcome: "processing"; diagnostics?: ConversionProviderDiagnostics }>
  | Readonly<{ outcome: "succeeded"; diagnostics?: ConversionProviderDiagnostics }>
  | Readonly<{
      outcome: "retryable_failed" | "permanent_failed";
      errorCode: string;
      errorCategory: ConversionErrorCategory;
      diagnostics?: ConversionProviderDiagnostics;
    }>;

export type ConversionDeliveryProvider = Readonly<{
  maximumAttemptDurationMs: number;
  deliver(delivery: ClaimedConversionDelivery): Promise<ConversionProviderResult>;
}>;

export type ConversionDeliveryRepository = Readonly<{
  recoverStaleClaims(now: Date): Promise<number>;
  claimNext(input: Readonly<{
    platform: ConversionPlatform;
    now: Date;
    leaseToken: string;
    leaseDurationMs: number;
  }>): Promise<ClaimedConversionDelivery | null>;
  markAccepted(input: Readonly<{ id: string; leaseToken: string; requestId: string; now: Date; nextAttemptAt: Date }>): Promise<boolean>;
  markProcessing(input: Readonly<{ id: string; leaseToken: string; now: Date; nextAttemptAt: Date; diagnostics?: ConversionProviderDiagnostics }>): Promise<boolean>;
  markSucceeded(input: Readonly<{ id: string; leaseToken: string; now: Date; diagnostics?: ConversionProviderDiagnostics }>): Promise<boolean>;
  markRetryableFailed(input: Readonly<{ id: string; leaseToken: string; now: Date; nextAttemptAt: Date; errorCode: string; errorCategory: ConversionErrorCategory; diagnostics?: ConversionProviderDiagnostics }>): Promise<boolean>;
  markPermanentFailed(input: Readonly<{ id: string; leaseToken: string; now: Date; errorCode: string; errorCategory: ConversionErrorCategory; diagnostics?: ConversionProviderDiagnostics }>): Promise<boolean>;
  markDeadLetter(input: Readonly<{ id: string; leaseToken: string; now: Date; errorCode: string; errorCategory: ConversionErrorCategory; diagnostics?: ConversionProviderDiagnostics }>): Promise<boolean>;
}>;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const MAX_ATTEMPTS = 12;

function retryDelay(attemptCount: number) {
  return Math.min(60 * MINUTE, Math.round(5 * MINUTE * 2 ** Math.max(0, attemptCount - 1)));
}

function googlePollDelay(attemptCount: number) {
  return Math.min(60 * MINUTE, Math.round(30 * MINUTE * 1.3 ** Math.max(0, attemptCount - 1)));
}

export function conversionDeliveryRuntimeEnabled(input: Readonly<{
  globalEnabled: boolean;
  platformEnabled: boolean;
  activationConfigured: boolean;
  durableRepositoryReady: boolean;
  credentialsConfigured: boolean;
  destinationConfigured: boolean;
}>) {
  return Object.values(input).every(Boolean);
}

export function createConversionDeliveryDispatcher(dependencies: Readonly<{
  repository: ConversionDeliveryRepository;
  provider: ConversionDeliveryProvider;
  enabled: boolean;
  now?: () => Date;
  createLeaseToken: () => string;
  leaseDurationMs?: number;
}>) {
  const leaseDurationMs = dependencies.leaseDurationMs ?? 5 * MINUTE;
  if (!Number.isSafeInteger(dependencies.provider.maximumAttemptDurationMs)
    || dependencies.provider.maximumAttemptDurationMs < 1
    || dependencies.provider.maximumAttemptDurationMs >= leaseDurationMs) {
    throw new Error("Provider attempt deadline must be shorter than the delivery lease");
  }
  return Object.freeze({
    async runOnce(platform: ConversionPlatform) {
      if (!dependencies.enabled) return Object.freeze({ outcome: "disabled" as const });
      const now = dependencies.now?.() ?? new Date();
      await dependencies.repository.recoverStaleClaims(now);
      const delivery = await dependencies.repository.claimNext({
        platform,
        now,
        leaseToken: dependencies.createLeaseToken(),
        leaseDurationMs,
      });
      if (!delivery) return Object.freeze({ outcome: "idle" as const });

      let result: ConversionProviderResult;
      try {
        result = await dependencies.provider.deliver(delivery);
      } catch {
        result = Object.freeze({
          outcome: "retryable_failed" as const,
          errorCode: "transport_exception",
          errorCategory: "transport" as const,
        });
      }

      if (result.outcome === "accepted") {
        await dependencies.repository.markAccepted({
          id: delivery.id,
          leaseToken: delivery.leaseToken,
          requestId: result.requestId,
          now,
          nextAttemptAt: new Date(now.getTime() + 30 * MINUTE),
        });
        return Object.freeze({ outcome: "accepted" as const });
      }
      if (result.outcome === "processing") {
        if (delivery.acceptedAt
          && now.getTime() - delivery.acceptedAt.getTime() >= 24 * HOUR) {
          await dependencies.repository.markDeadLetter({
            id: delivery.id,
            leaseToken: delivery.leaseToken,
            now,
            errorCode: "diagnostics_timeout",
            errorCategory: "observation_timeout",
          });
          return Object.freeze({ outcome: "dead_letter" as const });
        }
        await dependencies.repository.markProcessing({
          id: delivery.id,
          leaseToken: delivery.leaseToken,
          now,
          nextAttemptAt: new Date(now.getTime() + googlePollDelay(delivery.attemptCount)),
          ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
        });
        return Object.freeze({ outcome: "processing" as const });
      }
      if (result.outcome === "succeeded") {
        await dependencies.repository.markSucceeded({
          id: delivery.id,
          leaseToken: delivery.leaseToken,
          now,
          ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
        });
        return Object.freeze({ outcome: "succeeded" as const });
      }
      if (result.outcome === "permanent_failed") {
        await dependencies.repository.markPermanentFailed({
          id: delivery.id,
          leaseToken: delivery.leaseToken,
          now,
          errorCode: result.errorCode,
          errorCategory: result.errorCategory,
          ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
        });
        return Object.freeze({ outcome: "permanent_failed" as const });
      }
      if (delivery.attemptCount >= MAX_ATTEMPTS) {
        await dependencies.repository.markDeadLetter({
          id: delivery.id,
          leaseToken: delivery.leaseToken,
          now,
          errorCode: result.errorCode,
          errorCategory: result.errorCategory,
          ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
        });
        return Object.freeze({ outcome: "dead_letter" as const });
      }
      await dependencies.repository.markRetryableFailed({
        id: delivery.id,
        leaseToken: delivery.leaseToken,
        now,
        nextAttemptAt: new Date(now.getTime() + retryDelay(delivery.attemptCount)),
        errorCode: result.errorCode,
        errorCategory: result.errorCategory,
        ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
      });
      return Object.freeze({ outcome: "retryable_failed" as const });
    },
  });
}
