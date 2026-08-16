export type CustomerServiceConfig = Readonly<{
  enabled: boolean;
  pilotLimit: number;
  provider: "mock" | "openai";
  openaiApiKey: string;
  openaiModel: string;
  dailyWarningMicrousd: number;
  dailyHardStopMicrousd: number;
  totalWarningMicrousd: number;
  totalHardStopMicrousd: number;
  metaAppSecret: string;
  metaVerifyToken: string;
  metaPageId: string;
  idHashSecret: string;
  imageAnalysisEnabled: boolean;
  imageAnalysisModel: string;
  metaAttachmentAllowedHosts: readonly string[];
  blobReadWriteToken: string;
}>;

function boolean(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function positiveInteger(value: string | undefined, fallback: number, name: string) {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function usdMicrousd(value: string | undefined, fallback: number, name: string) {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be positive`);
  return Math.round(parsed * 1_000_000);
}

function required(env: NodeJS.ProcessEnv | Record<string, string | undefined>, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;

function attachmentAllowedHosts(value: string | undefined) {
  if (!value?.trim()) return Object.freeze([] as string[]);
  const hosts = value.split(",").map((host) => host.trim().toLowerCase());
  if (hosts.some((host) => !hostnamePattern.test(host))) {
    throw new Error("META_ATTACHMENT_ALLOWED_HOSTS contains an invalid hostname");
  }
  return Object.freeze(hosts);
}

export function parseCustomerServiceConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): CustomerServiceConfig {
  const enabled = boolean(env.REPLY_ASSISTANT_ENABLED);
  const provider = env.AI_PROVIDER?.trim() === "openai" ? "openai" : "mock";
  const openaiApiKey = env.OPENAI_API_KEY?.trim() ?? "";
  if (enabled && provider === "openai" && !openaiApiKey) throw new Error("OPENAI_API_KEY is required");
  const imageAnalysisEnabled = boolean(env.REPLY_ASSISTANT_IMAGE_ANALYSIS_ENABLED);
  const imageAnalysisModel = env.OPENAI_IMAGE_ANALYSIS_MODEL?.trim() ?? "";
  const blobReadWriteToken = env.BLOB_READ_WRITE_TOKEN?.trim() ?? "";
  const metaAttachmentAllowedHosts = attachmentAllowedHosts(env.META_ATTACHMENT_ALLOWED_HOSTS);
  if (imageAnalysisEnabled && !imageAnalysisModel) throw new Error("OPENAI_IMAGE_ANALYSIS_MODEL is required");
  if (imageAnalysisEnabled && !blobReadWriteToken) throw new Error("BLOB_READ_WRITE_TOKEN is required");
  if (imageAnalysisEnabled && metaAttachmentAllowedHosts.length === 0) {
    throw new Error("META_ATTACHMENT_ALLOWED_HOSTS is required");
  }
  return Object.freeze({
    enabled,
    pilotLimit: positiveInteger(env.REPLY_ASSISTANT_PILOT_LIMIT, 100, "REPLY_ASSISTANT_PILOT_LIMIT"),
    provider,
    openaiApiKey,
    openaiModel: env.OPENAI_MODEL?.trim() || "gpt-5.6-luna",
    dailyWarningMicrousd: usdMicrousd(env.AI_DAILY_WARNING_USD, 0.25, "AI_DAILY_WARNING_USD"),
    dailyHardStopMicrousd: usdMicrousd(env.AI_DAILY_HARD_STOP_USD, 1, "AI_DAILY_HARD_STOP_USD"),
    totalWarningMicrousd: usdMicrousd(env.AI_TOTAL_WARNING_USD, 2, "AI_TOTAL_WARNING_USD"),
    totalHardStopMicrousd: usdMicrousd(env.AI_TOTAL_HARD_STOP_USD, 5, "AI_TOTAL_HARD_STOP_USD"),
    metaAppSecret: enabled ? required(env, "META_APP_SECRET") : "",
    metaVerifyToken: enabled ? required(env, "META_VERIFY_TOKEN") : "",
    metaPageId: enabled ? required(env, "META_PAGE_ID") : "",
    idHashSecret: enabled ? required(env, "CUSTOMER_SERVICE_ID_HASH_SECRET") : "",
    imageAnalysisEnabled,
    imageAnalysisModel,
    metaAttachmentAllowedHosts,
    blobReadWriteToken,
  });
}

export function publicCustomerServiceConfig(config: CustomerServiceConfig) {
  return Object.freeze({ enabled: config.enabled, pilotLimit: config.pilotLimit });
}
