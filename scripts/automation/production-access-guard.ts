export type AutomationTargetMode = "LOCAL" | "PREVIEW" | "PRODUCTION_SMOKE";

export type ProductionCapability =
  | "DEFAULT"
  | "VISUAL"
  | "ATTRIBUTION"
  | "REPLY_ASSISTANT_TEST"
  | "EXTENDED";

export type GuardStatus =
  | { state: "ON" }
  | {
      state: "TEMP_BYPASS";
      owner: string;
      reason: string;
      startedAt: Date;
      expiresAt: Date;
    };

export type AssertAutomationTargetInput = Readonly<{
  rawUrl: string;
  targetMode: AutomationTargetMode;
  guardStatus: GuardStatus;
  productionSmokeAuthorized?: boolean;
}>;

export const DEFAULT_PRODUCTION_TTL_SECONDS = 120;
export const MAX_EXTENDED_PRODUCTION_TTL_SECONDS = 600;
export const AUTOMATION_SESSION_STORAGE_KEY = "rnr_automation";
export const AUTOMATION_CAPABILITY_STORAGE_KEY = "rnr_automation_capability";

export const OFFICIAL_PRODUCTION_HOSTS = Object.freeze([
  "rnrgallery.com",
  "www.rnrgallery.com",
  "rrgallery.co.nz",
  "www.rrgallery.co.nz",
]);

const officialProductionHosts = new Set<string>(OFFICIAL_PRODUCTION_HOSTS);
const attributionParameterNames = new Set(["gclid", "gbraid", "wbraid", "fbclid"]);
const blockedResourceTypes = new Set(["image", "media", "font"]);
const targetModes = new Set<AutomationTargetMode>(["LOCAL", "PREVIEW", "PRODUCTION_SMOKE"]);
const capabilities = new Set<ProductionCapability>([
  "DEFAULT",
  "VISUAL",
  "ATTRIBUTION",
  "REPLY_ASSISTANT_TEST",
  "EXTENDED",
]);

function blocked(code: string, message: string): never {
  throw new Error(`${code}: ${message}`);
}

function parseTargetUrl(rawUrl: string): URL {
  try {
    const url = new URL(rawUrl);
    url.hostname = url.hostname.toLowerCase();
    if (url.username || url.password) {
      blocked("AUTOMATION_TARGET_BLOCKED", "Target URLs must not include credentials");
    }
    return url;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("AUTOMATION_TARGET_BLOCKED:")) throw error;
    blocked("AUTOMATION_TARGET_BLOCKED", "Target URL is malformed");
  }
}

function isAttributionUrl(url: URL): boolean {
  for (const key of url.searchParams.keys()) {
    const normalized = key.toLowerCase();
    if (attributionParameterNames.has(normalized) || normalized.startsWith("utm_")) return true;
  }
  return false;
}

function isWellFormedTemporaryGrant(status: GuardStatus): status is Extract<GuardStatus, { state: "TEMP_BYPASS" }> {
  if (!status || status.state !== "TEMP_BYPASS") return false;
  const startedMs = status.startedAt instanceof Date ? status.startedAt.getTime() : Number.NaN;
  const expiresMs = status.expiresAt instanceof Date ? status.expiresAt.getTime() : Number.NaN;
  return Number.isFinite(startedMs)
    && Number.isFinite(expiresMs)
    && typeof status.owner === "string"
    && typeof status.reason === "string"
    && status.owner.trim().length > 0
    && status.reason.trim().length > 0
    && expiresMs > startedMs
    && expiresMs - startedMs <= MAX_EXTENDED_PRODUCTION_TTL_SECONDS * 1000;
}

function isValidTemporaryGrant(status: GuardStatus, now: Date): status is Extract<GuardStatus, { state: "TEMP_BYPASS" }> {
  return isWellFormedTemporaryGrant(status)
    && status.startedAt.getTime() <= now.getTime()
    && status.expiresAt.getTime() > now.getTime();
}

function assertParsedAutomationTarget(url: URL, input: AssertAutomationTargetInput): URL {
  if (!input || !targetModes.has(input.targetMode)) {
    blocked("AUTOMATION_TARGET_BLOCKED", "Target mode is invalid");
  }

  const isOfficialProduction = officialProductionHosts.has(url.hostname);
  // A status passed to this assertion is expected to come from
  // resolveGuardStatus; retain its bounded, well-formed grant properties
  // without introducing a second, non-injectable clock into the API.
  const temporaryBypass = isWellFormedTemporaryGrant(input.guardStatus);

  if (isOfficialProduction) {
    if (url.protocol === "https:"
      && ((input.targetMode === "PRODUCTION_SMOKE" && input.productionSmokeAuthorized === true) || temporaryBypass)) {
      return url;
    }
    blocked("PRODUCTION_AUTOMATION_BLOCKED", "Use approved Production Smoke workflow.");
  }

  if (input.targetMode === "LOCAL" && (url.protocol === "http:" || url.protocol === "https:")
    && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
    return url;
  }

  if (input.targetMode === "PREVIEW" && url.protocol === "https:"
    && url.hostname.endsWith(".vercel.app")) {
    return url;
  }

  blocked("AUTOMATION_TARGET_BLOCKED", "Target is not allowed for the selected mode");
}

export function assertAutomationTarget(input: AssertAutomationTargetInput): URL {
  const url = parseTargetUrl(input.rawUrl);
  return assertParsedAutomationTarget(url, input);
}

export function resolveGuardStatus(env: Readonly<Record<string, string | undefined>>, now: Date): GuardStatus {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return { state: "ON" };
  if (env.RNR_PRODUCTION_GUARD_TEMP_BYPASS !== "1"
    || env.RNR_PRODUCTION_GUARD_TEMP_BYPASS_AUTHORIZED !== "1") {
    return { state: "ON" };
  }

  const owner = env.RNR_PRODUCTION_GUARD_TEMP_BYPASS_OWNER?.trim() ?? "";
  const reason = env.RNR_PRODUCTION_GUARD_TEMP_BYPASS_REASON?.trim() ?? "";
  const startedAt = new Date(env.RNR_PRODUCTION_GUARD_TEMP_BYPASS_STARTED_AT ?? "");
  const expiresAt = new Date(env.RNR_PRODUCTION_GUARD_TEMP_BYPASS_EXPIRES_AT ?? "");
  const candidate: GuardStatus = { state: "TEMP_BYPASS", owner, reason, startedAt, expiresAt };
  return isValidTemporaryGrant(candidate, now) ? candidate : { state: "ON" };
}

export function resolveProductionTtlSeconds(
  capability: ProductionCapability,
  requested?: number,
): number {
  if (!capabilities.has(capability)) blocked("AUTOMATION_TTL_BLOCKED", "Capability is invalid");
  if (capability !== "EXTENDED") return DEFAULT_PRODUCTION_TTL_SECONDS;
  if (typeof requested !== "number" || !Number.isFinite(requested) || !Number.isInteger(requested)
    || requested <= DEFAULT_PRODUCTION_TTL_SECONDS
    || requested > MAX_EXTENDED_PRODUCTION_TTL_SECONDS) {
    blocked("AUTOMATION_TTL_BLOCKED", "EXTENDED TTL must be an integer from 121 through 600 seconds");
  }
  return requested as number;
}

export function shouldBlockProductionResource(
  resourceType: string,
  capability: ProductionCapability,
  allowMedia: boolean,
): boolean {
  if (!capabilities.has(capability)) blocked("AUTOMATION_RESOURCE_BLOCKED", "Capability is invalid");
  if (!blockedResourceTypes.has(resourceType)) return false;
  if (capability === "VISUAL" && (resourceType === "image" || resourceType === "font")) return false;
  if (capability === "VISUAL" && resourceType === "media" && allowMedia) return false;
  return true;
}

export function buildProductionSmokeUrl(input: Readonly<{
  rawUrl: string;
  capability: ProductionCapability;
  guardStatus: GuardStatus;
  productionSmokeAuthorized: boolean;
}>): URL {
  if (!capabilities.has(input.capability)) blocked("AUTOMATION_TARGET_BLOCKED", "Capability is invalid");
  const url = parseTargetUrl(input.rawUrl);
  if (isAttributionUrl(url) && input.capability !== "ATTRIBUTION") {
    blocked("AUTOMATION_ATTRIBUTION_CAPABILITY_REQUIRED", "Attribution URLs require the ATTRIBUTION capability");
  }
  return assertParsedAutomationTarget(url, {
    rawUrl: url.toString(),
    targetMode: "PRODUCTION_SMOKE",
    guardStatus: input.guardStatus,
    productionSmokeAuthorized: input.productionSmokeAuthorized,
  });
}
