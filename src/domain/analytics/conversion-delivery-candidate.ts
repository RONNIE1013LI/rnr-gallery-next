import { createHash } from "node:crypto";
import type {
  ConversionAttributionSnapshot,
  ConversionConsentSnapshot,
  ConversionEventSource,
  ConversionPlatform,
  ConversionUserDataSnapshot,
} from "@/server/db/schema/analytics";

type Environment = Readonly<Record<string, string | undefined>>;
export type ConversionPlatformPolicy = Readonly<{
  enabled: boolean;
  activatedAt: Date | null;
}>;
export type ConversionActivationPolicy = Readonly<Record<
  ConversionPlatform,
  ConversionPlatformPolicy
>>;

export type ConversionDeliveryCandidateInput = Readonly<{
  jobId: string;
  source: "manual" | "web";
  createdAt: Date;
  confirmedAt: Date;
  customerSource: string;
  customerEmail: string;
  customerPhone: string;
  manualPaymentStatus: string | null;
  amountPaidCents: number | null;
  linkedOnlineOrder: boolean;
  invoice: Readonly<{
    authoritative: boolean;
    status: string;
    currency: string;
    totalInclGstCents: number;
  }> | null;
  customFields: Readonly<Record<string, string | undefined>>;
}>;

export type ConversionDeliveryCandidate = Readonly<{
  platform: ConversionPlatform;
  transactionId: string;
  jobId: string;
  eventType: "purchase";
  eventOccurredAt: Date;
  eventSource: ConversionEventSource;
  currency: "NZD" | "AUD";
  valueMinor: number;
  consentSnapshot: ConversionConsentSnapshot;
  attributionSnapshot: ConversionAttributionSnapshot;
  userDataSnapshot: ConversionUserDataSnapshot;
  nextAttemptAt: Date;
}>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLICK_PATTERN = /^[A-Za-z0-9._~-]{1,200}$/;
const META_COOKIE_PATTERN = /^fb\.1\.\d{10,13}\.[A-Za-z0-9._-]{1,200}$/;
const CONSENT_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function activation(value: string | undefined): Date | null {
  const normalized = value?.trim() ?? "";
  if (!CONSENT_TIMESTAMP_PATTERN.test(normalized)) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseConversionActivationPolicy(env: Environment): ConversionActivationPolicy {
  const globalEnabled = env.MANUAL_OFFLINE_CONVERSIONS_ENABLED === "true";
  const platform = (name: "GOOGLE" | "META"): ConversionPlatformPolicy => {
    const activatedAt = activation(env[`${name}_MANUAL_CONVERSIONS_ACTIVATED_AT`]);
    const enabled = globalEnabled
      && env[`${name}_MANUAL_CONVERSIONS_ENABLED`] === "true"
      && activatedAt !== null;
    return Object.freeze({ enabled, activatedAt: enabled ? activatedAt : null });
  };
  return Object.freeze({ google: platform("GOOGLE"), meta: platform("META") });
}

function normalizedFields(fields: ConversionDeliveryCandidateInput["customFields"]) {
  return Object.freeze(Object.fromEntries(Object.entries(fields).map(([key, value]) => [
    key,
    value?.trim() ?? "",
  ])));
}

function declaredPlatform(value: string): ConversionPlatform | null {
  switch (value.toLowerCase()) {
    case "google":
    case "google_ads":
      return "google";
    case "meta":
    case "facebook":
    case "facebook_ads":
    case "messenger":
    case "instagram":
    case "whatsapp":
      return "meta";
    default:
      return null;
  }
}

function eventSource(source: string): ConversionEventSource {
  if (["messenger", "instagram", "whatsapp"].includes(source)) return "MESSAGE";
  if (source === "phone") return "PHONE";
  if (source === "web") return "WEB";
  return "OTHER";
}

function hash(value: string): string | undefined {
  return value ? createHash("sha256").update(value).digest("hex") : undefined;
}

function userData(email: string, phone: string): ConversionUserDataSnapshot {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedPhone = phone.replace(/\D/g, "");
  return Object.freeze({
    version: 1,
    ...(hash(normalizedEmail) ? { hashedEmail: hash(normalizedEmail) } : {}),
    ...(hash(normalizedPhone) ? { hashedPhone: hash(normalizedPhone) } : {}),
  });
}

function attribution(
  platform: ConversionPlatform,
  fields: Readonly<Record<string, string>>,
): ConversionAttributionSnapshot | null {
  if (platform === "google") {
    const values = (["gclid", "gbraid", "wbraid"] as const)
      .flatMap((key) => fields[key] ? [{ key, value: fields[key] }] : []);
    if (values.length > 1 || values.some(({ value }) => !CLICK_PATTERN.test(value))) return null;
    return Object.freeze({
      version: 1,
      source: "google",
      ...(values[0] ? { [values[0].key]: values[0].value } : {}),
    });
  }
  if (fields.fbclid && !CLICK_PATTERN.test(fields.fbclid)) return null;
  if (fields.fbp && !META_COOKIE_PATTERN.test(fields.fbp)) return null;
  if (fields.fbc && !META_COOKIE_PATTERN.test(fields.fbc)) return null;
  return Object.freeze({
    version: 1,
    source: "meta",
    ...(fields.fbclid ? { fbclid: fields.fbclid } : {}),
    ...(fields.fbp ? { fbp: fields.fbp } : {}),
    ...(fields.fbc ? { fbc: fields.fbc } : {}),
  });
}

export function buildConversionDeliveryCandidates(
  input: ConversionDeliveryCandidateInput,
  policy: ConversionActivationPolicy,
): readonly ConversionDeliveryCandidate[] {
  const fields = normalizedFields(input.customFields);
  const consentAt = fields.advertising_consent_recorded_at;
  const consentDate = activation(consentAt);
  const invoice = input.invoice;
  if (!UUID_PATTERN.test(input.jobId)
    || input.source !== "manual"
    || input.manualPaymentStatus !== "paid"
    || !Number.isSafeInteger(input.amountPaidCents)
    || (input.amountPaidCents ?? 0) <= 0
    || input.linkedOnlineOrder
    || !invoice?.authoritative
    || invoice.totalInclGstCents !== input.amountPaidCents
    || (invoice.currency !== "NZD" && invoice.currency !== "AUD")
    || fields.advertising_consent !== "granted"
    || !consentDate
    || consentDate > input.confirmedAt) return Object.freeze([]);

  const platform = declaredPlatform(fields.advertising_source);
  if (!platform) return Object.freeze([]);
  const activationPolicy = policy[platform];
  if (!activationPolicy.enabled || !activationPolicy.activatedAt
    || input.createdAt < activationPolicy.activatedAt
    || input.confirmedAt < activationPolicy.activatedAt) return Object.freeze([]);

  const attributionSnapshot = attribution(platform, fields);
  const userDataSnapshot = userData(input.customerEmail, input.customerPhone);
  if (!attributionSnapshot) return Object.freeze([]);
  const hasAttribution = Object.keys(attributionSnapshot).some((key) => !["version", "source"].includes(key));
  const hasUserData = Boolean(userDataSnapshot.hashedEmail || userDataSnapshot.hashedPhone);
  if (!hasAttribution && !hasUserData) return Object.freeze([]);

  const consentSnapshot: ConversionConsentSnapshot = Object.freeze({
    version: 1,
    decision: "granted",
    recordedAt: consentDate.toISOString(),
    evidenceSource: "manual_order_field",
    adUserData: "CONSENT_GRANTED",
    adPersonalization: "CONSENT_DENIED",
  });
  return Object.freeze([Object.freeze({
    platform,
    transactionId: `manual-order:${input.jobId.toLowerCase()}`,
    jobId: input.jobId.toLowerCase(),
    eventType: "purchase" as const,
    eventOccurredAt: new Date(input.confirmedAt.getTime()),
    eventSource: eventSource(input.customerSource),
    currency: invoice.currency,
    valueMinor: invoice.totalInclGstCents,
    consentSnapshot,
    attributionSnapshot,
    userDataSnapshot,
    nextAttemptAt: new Date(input.confirmedAt.getTime()),
  })]);
}
