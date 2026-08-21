import { createHmac } from "node:crypto";
import { pricingForReviewedImageModel } from "./usage-cost";

export type CustomerServiceConfig = Readonly<{
  enabled: boolean;
  websiteEnabled: boolean;
  pilotLimit: number;
  conversationDebounceMs: number;
  humanReplyGroupMs: number;
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
  attachmentSourceEncryptionKey: string;
  imageJobRunnerSecret: string;
  turnRecoverySecret: string;
  websiteSessionSecret: string;
  websiteAbuseHashSecret: string;
  reviewLinkSecret: string;
  reviewAlertProviderScopeFingerprint: string;
  replyAssistantAlertTo: string;
  websiteDailyWarningMicrousd: number;
  websiteDailyHardStopMicrousd: number;
  websiteTotalHardStopMicrousd: number;
}>;

function boolean(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function positiveInteger(value: string | undefined, fallback: number, name: string) {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function boundedInteger(value: string | undefined, fallback: number, name: string, min: number, max: number) {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return parsed;
}

function usdMicrousd(value: string | undefined, fallback: number, name: string) {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be positive`);
  const microusd = Math.round(parsed * 1_000_000);
  if (!Number.isSafeInteger(microusd)) throw new Error(`${name} is too large`);
  return microusd;
}

function required(env: NodeJS.ProcessEnv | Record<string, string | undefined>, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredSecret(env: NodeJS.ProcessEnv | Record<string, string | undefined>, name: string) {
  const value = required(env, name);
  if (value.length < 32) throw new Error(`${name} must be at least 32 characters`);
  return value;
}

function requiredEmail(env: NodeJS.ProcessEnv | Record<string, string | undefined>, name: string) {
  const value = required(env, name);
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error(`${name} must be a valid email address`);
  }
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
  const websiteEnabled = boolean(env.WEBSITE_CUSTOMER_ASSISTANT_ENABLED);
  const provider = env.AI_PROVIDER?.trim() === "openai" ? "openai" : "mock";
  const openaiApiKey = env.OPENAI_API_KEY?.trim() ?? "";
  if ((enabled || websiteEnabled) && provider === "openai" && !openaiApiKey) {
    throw new Error("OPENAI_API_KEY is required");
  }
  const imageAnalysisEnabled = boolean(env.REPLY_ASSISTANT_IMAGE_ANALYSIS_ENABLED);
  const imageAnalysisModel = env.OPENAI_IMAGE_ANALYSIS_MODEL?.trim() ?? "";
  const blobReadWriteToken = env.BLOB_READ_WRITE_TOKEN?.trim() ?? "";
  const metaAttachmentAllowedHosts = attachmentAllowedHosts(env.META_ATTACHMENT_ALLOWED_HOSTS);
  if (imageAnalysisEnabled && !imageAnalysisModel) throw new Error("OPENAI_IMAGE_ANALYSIS_MODEL is required");
  if (imageAnalysisEnabled && !blobReadWriteToken) throw new Error("BLOB_READ_WRITE_TOKEN is required");
  if (imageAnalysisEnabled && metaAttachmentAllowedHosts.length === 0) {
    throw new Error("META_ATTACHMENT_ALLOWED_HOSTS is required");
  }
  const attachmentSourceEncryptionKey = imageAnalysisEnabled
    ? requiredSecret(env, "CUSTOMER_SERVICE_ATTACHMENT_SOURCE_ENCRYPTION_KEY")
    : "";
  const imageJobRunnerSecret = imageAnalysisEnabled
    ? requiredSecret(env, "REPLY_ASSISTANT_JOB_RUNNER_SECRET")
    : "";
  if (imageAnalysisEnabled && provider === "openai") pricingForReviewedImageModel(imageAnalysisModel);
  const websiteSessionSecret = websiteEnabled ? requiredSecret(env, "CUSTOMER_CHAT_SESSION_SECRET") : "";
  const websiteAbuseHashSecret = websiteEnabled ? requiredSecret(env, "CUSTOMER_CHAT_ABUSE_HASH_SECRET") : "";
  const reviewLinkSecret = websiteEnabled ? requiredSecret(env, "REPLY_ASSISTANT_REVIEW_LINK_SECRET") : "";
  if (websiteEnabled && websiteSessionSecret === websiteAbuseHashSecret) {
    throw new Error("CUSTOMER_CHAT_SESSION_SECRET and CUSTOMER_CHAT_ABUSE_HASH_SECRET must differ");
  }
  if (
    websiteEnabled
    && (reviewLinkSecret === websiteSessionSecret || reviewLinkSecret === websiteAbuseHashSecret)
  ) {
    throw new Error("REPLY_ASSISTANT_REVIEW_LINK_SECRET must differ from website session and abuse secrets");
  }
  const resendApiKey = env.RESEND_API_KEY?.trim() ?? "";
  const reviewAlertProviderScopeFingerprint = websiteEnabled && resendApiKey
    ? createHmac("sha256", reviewLinkSecret)
      .update("review-alert-provider-scope\0")
      .update(resendApiKey)
      .digest("hex")
    : "";
  const replyAssistantAlertTo = websiteEnabled ? requiredEmail(env, "REPLY_ASSISTANT_ALERT_TO") : "";
  const websiteDailyWarningMicrousd = websiteEnabled
    ? usdMicrousd(env.WEBSITE_CHAT_DAILY_WARNING_USD, 0.1, "WEBSITE_CHAT_DAILY_WARNING_USD")
    : 100_000;
  const websiteDailyHardStopMicrousd = websiteEnabled
    ? usdMicrousd(env.WEBSITE_CHAT_DAILY_HARD_STOP_USD, 0.25, "WEBSITE_CHAT_DAILY_HARD_STOP_USD")
    : 250_000;
  const websiteTotalHardStopMicrousd = websiteEnabled
    ? usdMicrousd(env.WEBSITE_CHAT_TOTAL_HARD_STOP_USD, 2, "WEBSITE_CHAT_TOTAL_HARD_STOP_USD")
    : 2_000_000;
  if (websiteDailyWarningMicrousd >= websiteDailyHardStopMicrousd) {
    throw new Error("WEBSITE_CHAT_DAILY_WARNING_USD must be below WEBSITE_CHAT_DAILY_HARD_STOP_USD");
  }
  if (websiteTotalHardStopMicrousd < websiteDailyHardStopMicrousd) {
    throw new Error("WEBSITE_CHAT_TOTAL_HARD_STOP_USD must be at least WEBSITE_CHAT_DAILY_HARD_STOP_USD");
  }
  return Object.freeze({
    enabled,
    websiteEnabled,
    pilotLimit: positiveInteger(env.REPLY_ASSISTANT_PILOT_LIMIT, 100, "REPLY_ASSISTANT_PILOT_LIMIT"),
    conversationDebounceMs: boundedInteger(
      env.REPLY_ASSISTANT_DEBOUNCE_MS,
      2_000,
      "REPLY_ASSISTANT_DEBOUNCE_MS",
      250,
      10_000,
    ),
    humanReplyGroupMs: boundedInteger(
      env.REPLY_ASSISTANT_HUMAN_REPLY_GROUP_MS,
      90_000,
      "REPLY_ASSISTANT_HUMAN_REPLY_GROUP_MS",
      10_000,
      120_000,
    ),
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
    attachmentSourceEncryptionKey,
    imageJobRunnerSecret,
    turnRecoverySecret: enabled || websiteEnabled ? requiredSecret(env, "CRON_SECRET") : "",
    websiteSessionSecret,
    websiteAbuseHashSecret,
    reviewLinkSecret,
    reviewAlertProviderScopeFingerprint,
    replyAssistantAlertTo,
    websiteDailyWarningMicrousd,
    websiteDailyHardStopMicrousd,
    websiteTotalHardStopMicrousd,
  });
}

export function publicCustomerServiceConfig(config: CustomerServiceConfig) {
  return Object.freeze({
    enabled: config.enabled,
    websiteEnabled: config.websiteEnabled,
    pilotLimit: config.pilotLimit,
  });
}
