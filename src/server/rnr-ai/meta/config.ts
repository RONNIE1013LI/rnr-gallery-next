export type RnrAiEngineMode = "legacy" | "shadow" | "shared_draft" | "shared_active";

export type RnrAiMetaConfig = Readonly<{
  masterEnabled: boolean;
  engineMode: RnrAiEngineMode;
  metaAutoSendEnabled: boolean;
  websiteSharedBrainEnabled: boolean;
  allCustomersActivatedAt?: Date | null;
  stageAAllowedRecipientHash: string | null;
  stageAActivatedAt: Date | null;
}>;

const engineModes = new Set<RnrAiEngineMode>([
  "legacy",
  "shadow",
  "shared_draft",
  "shared_active",
]);

function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function engineMode(value: string | undefined): RnrAiEngineMode {
  const candidate = value?.trim().toLowerCase() as RnrAiEngineMode | undefined;
  return candidate && engineModes.has(candidate) ? candidate : "legacy";
}

function stageAAllowedRecipientHash(value: string | undefined) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function stageAActivatedAt(value: string | undefined) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? parsed : null;
}

export function parseRnrAiMetaConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): RnrAiMetaConfig {
  return Object.freeze({
    allCustomersActivatedAt: stageAActivatedAt(env.RNR_META_ALL_CUSTOMERS_ACTIVATED_AT),
    masterEnabled: enabled(env.RNR_AI_MASTER_ENABLED),
    engineMode: engineMode(env.RNR_AI_ENGINE_MODE),
    metaAutoSendEnabled: enabled(env.RNR_META_AUTO_SEND_ENABLED),
    websiteSharedBrainEnabled: enabled(env.RNR_WEBSITE_SHARED_BRAIN_ENABLED),
    stageAAllowedRecipientHash: stageAAllowedRecipientHash(env.RNR_META_STAGE_A_ALLOWED_RECIPIENT_HASH),
    stageAActivatedAt: stageAActivatedAt(env.RNR_META_STAGE_A_ACTIVATED_AT),
  });
}

// Missing or invalid full activation retains the single-recipient Stage A fallback.
type MetaActivationConfig = Pick<RnrAiMetaConfig, "allCustomersActivatedAt" | "stageAActivatedAt" | "stageAAllowedRecipientHash">;

function validDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export function metaActivationCutoff(config: MetaActivationConfig): Date | null {
  if (validDate(config.allCustomersActivatedAt)) return config.allCustomersActivatedAt;
  return validDate(config.stageAActivatedAt) ? config.stageAActivatedAt : null;
}

export function metaRecipientAllowed(config: MetaActivationConfig, recipientHash: string): boolean {
  return validDate(config.allCustomersActivatedAt)
    || Boolean(config.stageAAllowedRecipientHash && recipientHash === config.stageAAllowedRecipientHash);
}

export function metaActivationConfigured(config: MetaActivationConfig): boolean {
  return Boolean(metaActivationCutoff(config)
    && (validDate(config.allCustomersActivatedAt) || config.stageAAllowedRecipientHash));
}

export function metaMessageWithinReplyWindow(receivedAt: Date, now: Date): boolean {
  const ageMs = now.getTime() - receivedAt.getTime();
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 24 * 60 * 60 * 1_000;
}
