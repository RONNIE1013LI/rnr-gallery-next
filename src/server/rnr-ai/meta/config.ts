export type RnrAiEngineMode = "legacy" | "shadow" | "shared_draft" | "shared_active";

export type RnrAiMetaConfig = Readonly<{
  masterEnabled: boolean;
  engineMode: RnrAiEngineMode;
  metaAutoSendEnabled: boolean;
  websiteSharedBrainEnabled: boolean;
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

export function parseRnrAiMetaConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): RnrAiMetaConfig {
  return Object.freeze({
    masterEnabled: enabled(env.RNR_AI_MASTER_ENABLED),
    engineMode: engineMode(env.RNR_AI_ENGINE_MODE),
    metaAutoSendEnabled: enabled(env.RNR_META_AUTO_SEND_ENABLED),
    websiteSharedBrainEnabled: enabled(env.RNR_WEBSITE_SHARED_BRAIN_ENABLED),
  });
}
