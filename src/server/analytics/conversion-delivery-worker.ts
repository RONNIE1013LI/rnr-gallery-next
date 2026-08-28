import { randomUUID } from "node:crypto";
import {
  createConversionDeliveryDispatcher,
  type ConversionDeliveryProvider,
  type ConversionDeliveryRepository,
} from "./conversion-delivery-dispatcher";
import {
  createGoogleDataManagerDeliveryProvider,
  createMetaCapiDeliveryProvider,
} from "./conversion-delivery-providers";
import {
  createGoogleDataManagerClient,
  parseGoogleDataManagerDestinationConfig,
} from "./google-data-manager-client";
import {
  createGoogleDataManagerOAuthTokenProvider,
  parseGoogleDataManagerOAuthCredentials,
} from "./google-data-manager-oauth";
import { createMetaCapiClient } from "./meta-capi-client";
import { createDrizzleConversionDeliveryRepository } from "./drizzle-conversion-delivery-repository";
import { getDatabase } from "@/server/db/client";

type Environment = Readonly<Record<string, string | undefined>>;

export type ConversionDeliveryWorkerResult = Readonly<{
  result: "disabled" | "processed" | "unavailable";
  googleProcessed: number;
  metaProcessed: number;
}>;

const ACTIVATION_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function validActivation(value: string | undefined) {
  const normalized = value?.trim() ?? "";
  if (!ACTIVATION_PATTERN.test(normalized)) return false;
  return !Number.isNaN(new Date(normalized).getTime());
}

export function resolveConversionDeliveryWorkerConfig(env: Environment) {
  const globalEnabled = env.MANUAL_OFFLINE_CONVERSIONS_ENABLED === "true";
  const googleEnabled = globalEnabled
    && env.GOOGLE_MANUAL_CONVERSIONS_ENABLED === "true"
    && validActivation(env.GOOGLE_MANUAL_CONVERSIONS_ACTIVATED_AT)
    && parseGoogleDataManagerDestinationConfig(env) !== null
    && parseGoogleDataManagerOAuthCredentials(env) !== null;
  const metaEnabled = globalEnabled
    && env.META_MANUAL_CONVERSIONS_ENABLED === "true"
    && validActivation(env.META_MANUAL_CONVERSIONS_ACTIVATED_AT)
    && Boolean(env.META_CAPI_ACCESS_TOKEN?.trim());
  return Object.freeze({ googleEnabled, metaEnabled });
}

type Dependencies = Readonly<{
  env: Environment;
  createRepository: () => ConversionDeliveryRepository;
  googleProvider: ConversionDeliveryProvider | null;
  metaProvider: ConversionDeliveryProvider | null;
  createLeaseToken?: () => string;
  now?: () => Date;
}>;

export function createConversionDeliveryWorker(dependencies: Dependencies) {
  return Object.freeze({
    async run(limit = 10): Promise<ConversionDeliveryWorkerResult> {
      const boundedLimit = Math.max(1, Math.min(25, Math.trunc(limit)));
      const config = resolveConversionDeliveryWorkerConfig(dependencies.env);
      if (!config.googleEnabled && !config.metaEnabled) {
        return Object.freeze({ result: "disabled", googleProcessed: 0, metaProcessed: 0 });
      }
      if ((config.googleEnabled && !dependencies.googleProvider)
        || (config.metaEnabled && !dependencies.metaProvider)) {
        return Object.freeze({ result: "unavailable", googleProcessed: 0, metaProcessed: 0 });
      }

      try {
        const repository = dependencies.createRepository();
        const processed = { google: 0, meta: 0 };
        for (const [platform, enabled, provider] of [
          ["google", config.googleEnabled, dependencies.googleProvider],
          ["meta", config.metaEnabled, dependencies.metaProvider],
        ] as const) {
          if (!enabled || !provider) continue;
          const dispatcher = createConversionDeliveryDispatcher({
            repository,
            provider,
            enabled: true,
            createLeaseToken: dependencies.createLeaseToken ?? randomUUID,
            ...(dependencies.now ? { now: dependencies.now } : {}),
          });
          for (let index = 0; index < boundedLimit; index += 1) {
            const outcome = await dispatcher.runOnce(platform);
            if (outcome.outcome === "idle" || outcome.outcome === "disabled") break;
            processed[platform] += 1;
          }
        }
        return Object.freeze({
          result: "processed",
          googleProcessed: processed.google,
          metaProcessed: processed.meta,
        });
      } catch {
        return Object.freeze({ result: "unavailable", googleProcessed: 0, metaProcessed: 0 });
      }
    },
  });
}

export function createProductionConversionDeliveryWorker(
  env: Environment = process.env,
) {
  const googleCredentials = parseGoogleDataManagerOAuthCredentials(env);
  const googleDestination = parseGoogleDataManagerDestinationConfig(env);
  const googleProvider = googleCredentials && googleDestination
    ? createGoogleDataManagerDeliveryProvider(createGoogleDataManagerClient({
        config: googleDestination,
        tokenProvider: createGoogleDataManagerOAuthTokenProvider({ credentials: googleCredentials }),
        fetchImpl: fetch,
      }))
    : null;
  const metaToken = env.META_CAPI_ACCESS_TOKEN?.trim() ?? "";
  const metaClient = metaToken ? createMetaCapiClient({ accessToken: metaToken }) : null;
  return createConversionDeliveryWorker({
    env,
    createRepository: () => createDrizzleConversionDeliveryRepository(getDatabase()),
    googleProvider,
    metaProvider: metaClient
      ? createMetaCapiDeliveryProvider({ maximumAttemptDurationMs: 1_500, send: metaClient.send })
      : null,
  });
}
