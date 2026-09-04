export type RnrAiEngineMode = "legacy" | "shadow" | "shared_draft" | "shared_active";

export type RnrAiMetaConfig = Readonly<{
  masterEnabled: boolean;
  engineMode: RnrAiEngineMode;
  metaAutoSendEnabled: boolean;
  websiteSharedBrainEnabled: boolean;
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
    masterEnabled: enabled(env.RNR_AI_MASTER_ENABLED),
    engineMode: engineMode(env.RNR_AI_ENGINE_MODE),
    metaAutoSendEnabled: enabled(env.RNR_META_AUTO_SEND_ENABLED),
    websiteSharedBrainEnabled: enabled(env.RNR_WEBSITE_SHARED_BRAIN_ENABLED),
    stageAAllowedRecipientHash: stageAAllowedRecipientHash(env.RNR_META_STAGE_A_ALLOWED_RECIPIENT_HASH),
    stageAActivatedAt: stageAActivatedAt(env.RNR_META_STAGE_A_ACTIVATED_AT),
  });
}
