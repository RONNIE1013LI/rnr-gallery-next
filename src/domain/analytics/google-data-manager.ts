import { createHash } from "node:crypto";

export type GoogleDataManagerConsent = "granted" | "denied" | "unknown" | null;
export type GoogleDataManagerEventSource = "WEB" | "MESSAGE" | "PHONE" | "OTHER";
export type GoogleClickIdentifierKind = "gclid" | "gbraid" | "wbraid";
export type GoogleAdIdentifiers = Readonly<Partial<Record<GoogleClickIdentifierKind, string>>>;
export type GoogleUserIdentifier = Readonly<{ emailAddress: string } | { phoneNumber: string }>;
export type GoogleDataManagerUserData = Readonly<{
  userIdentifiers: readonly GoogleUserIdentifier[];
}>;
export type GoogleDataManagerEvent = Readonly<{
  transactionId: string;
  eventTimestamp: string;
  conversionValue: number;
  currency: "NZD" | "AUD";
  eventSource: GoogleDataManagerEventSource;
  adIdentifiers?: GoogleAdIdentifiers;
  userData?: GoogleDataManagerUserData;
  consent: Readonly<{
    adUserData: "CONSENT_GRANTED";
    adPersonalization: "CONSENT_DENIED";
  }>;
}>;

export type GoogleDataManagerEventInput = Readonly<{
  transactionId: string;
  manualPaymentConfirmedAt: Date | null;
  currency: string | null | undefined;
  amountMinor: number;
  source: string;
  attribution?: GoogleAdIdentifiers;
  email?: string;
  phone?: string;
  consent: GoogleDataManagerConsent;
}>;

export type GoogleDataManagerSkippedReason =
  | "consent_denied"
  | "consent_unknown"
  | "no_identifier"
  | "invalid_currency"
  | "invalid_value"
  | "invalid_transaction_id"
  | "missing_created_at"
  | "missing_confirmed_at"
  | "invalid_activation"
  | "before_activation"
  | "historical_order"
  | "not_paid_transition"
  | "already_delivered"
  | "feature_disabled";

export type GoogleDataManagerDeliveryResult =
  | Readonly<{ outcome: "disabled"; reason: "feature_disabled" }>
  | Readonly<{ outcome: "skipped"; reason: GoogleDataManagerSkippedReason }>
  | Readonly<{ outcome: "validate_only_success"; requestId?: string }>
  | Readonly<{ outcome: "accepted"; requestId: string }>
  | Readonly<{ outcome: "processing"; requestId: string }>
  | Readonly<{ outcome: "succeeded"; requestId: string }>
  | Readonly<{ outcome: "retryable_error"; status?: number }>
  | Readonly<{ outcome: "permanent_error"; status?: number }>
  | Readonly<{ outcome: "blocked_no_durable_store" }>;

export type GoogleDataManagerEligibilityInput = GoogleDataManagerEventInput & Readonly<{
  manualConversionsEnabled: boolean;
  googleManualConversionsEnabled: boolean;
  activationAt: string | undefined;
  orderCreatedAt: Date | null;
  previousPaymentStatus: string | null;
  currentPaymentStatus: string | null;
  priorDeliveryState: "pending" | "accepted" | "processing" | "succeeded" | "retryable_failed" | "permanent_failed" | "dead_letter" | null;
  hasDurableDeliveryStore: boolean;
}>;

export type GoogleDataManagerEligibilityResult =
  | Readonly<{ outcome: "ready"; event: GoogleDataManagerEvent }>
  | Extract<GoogleDataManagerDeliveryResult, { outcome: "disabled" | "skipped" | "blocked_no_durable_store" }>;

const CLICK_IDENTIFIER_PATTERN = /^[A-Za-z0-9._~-]{1,200}$/;
const TRANSACTION_ID_PATTERN = /^[A-Za-z0-9:_-]{3,100}$/;
const RFC3339_UTC_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/;

function freeze<T>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function validDate(value: Date | null): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime()) && value.getTime() > 0;
}

function normalizeCurrency(value: string | null | undefined): "NZD" | "AUD" | null {
  const currency = value?.trim().toUpperCase();
  return currency === "NZD" || currency === "AUD" ? currency : null;
}

function isValidActivation(value: string | undefined): value is string {
  if (!value) return false;
  const match = RFC3339_UTC_PATTERN.exec(value);
  if (!match) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3])
    && date.getUTCHours() === Number(match[4])
    && date.getUTCMinutes() === Number(match[5])
    && date.getUTCSeconds() === Number(match[6]);
}

export function normalizeGoogleEmail(value: string | undefined): string | null {
  const email = value?.replace(/\s/g, "").toLowerCase() ?? "";
  const at = email.lastIndexOf("@");
  if (at <= 0 || at !== email.indexOf("@")) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!local || !domain || /\s/.test(email)) return null;
  if (domain !== "gmail.com" && domain !== "googlemail.com") return email;
  return `${local.replace(/\+.*/, "").replace(/\./g, "")}@${domain}`;
}

export function normalizeGooglePhone(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed.startsWith("+") || /[^+\d\s().-]/.test(trimmed)) return null;
  const normalized = `+${trimmed.slice(1).replace(/[\s().-]/g, "")}`;
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

function sha256(value: string | null): string | null {
  return value ? createHash("sha256").update(value).digest("hex") : null;
}

export function hashGoogleEmail(value: string | undefined): string | null {
  return sha256(normalizeGoogleEmail(value));
}

export function hashGooglePhone(value: string | undefined): string | null {
  return sha256(normalizeGooglePhone(value));
}

export function mapGoogleEventSource(value: string): GoogleDataManagerEventSource {
  const source = value.trim().toLowerCase();
  if (/(^|\s)(web|website|checkout|form)(\s|$)/.test(source)) return "WEB";
  if (/(^|\s)(messenger|whatsapp|sms|email)(\s|$)/.test(source)) return "MESSAGE";
  if (/(^|\s)(phone|telephone)(\s|$)/.test(source)) return "PHONE";
  return "OTHER";
}

export function mapGoogleAdIdentifiers(value: GoogleAdIdentifiers | undefined): GoogleAdIdentifiers | null {
  const entries = (["gclid", "gbraid", "wbraid"] as const)
    .map((kind) => [kind, value?.[kind]] as const)
    .filter(([, identifier]) => Boolean(identifier?.trim()));
  if (entries.length !== 1) return null;
  const [kind, rawIdentifier] = entries[0];
  const identifier = rawIdentifier?.trim() ?? "";
  if (!CLICK_IDENTIFIER_PATTERN.test(identifier)) return null;
  return freeze({ [kind]: identifier });
}

export function toGoogleConversionValue(
  amountMinor: number,
  currencyInput: string | null | undefined,
): Readonly<{ currency: "NZD" | "AUD"; conversionValue: number }> | null {
  const currency = normalizeCurrency(currencyInput);
  if (!currency || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  const major = Math.trunc(amountMinor / 100);
  const cents = amountMinor % 100;
  return freeze({ currency, conversionValue: Number(`${major}.${String(cents).padStart(2, "0")}`) });
}

export function buildGoogleDataManagerEvent(
  input: GoogleDataManagerEventInput,
): GoogleDataManagerEvent | null {
  if (input.consent !== "granted"
    || !TRANSACTION_ID_PATTERN.test(input.transactionId)
    || !validDate(input.manualPaymentConfirmedAt)) return null;
  const value = toGoogleConversionValue(input.amountMinor, input.currency);
  if (!value) return null;
  const adIdentifiers = mapGoogleAdIdentifiers(input.attribution);
  const emailAddress = hashGoogleEmail(input.email);
  const phoneNumber = hashGooglePhone(input.phone);
  const identifiers = [
    ...(emailAddress ? [freeze({ emailAddress })] : []),
    ...(phoneNumber ? [freeze({ phoneNumber })] : []),
  ];
  return freeze({
    transactionId: input.transactionId,
    eventTimestamp: input.manualPaymentConfirmedAt.toISOString(),
    conversionValue: value.conversionValue,
    currency: value.currency,
    eventSource: mapGoogleEventSource(input.source),
    ...(adIdentifiers ? { adIdentifiers } : {}),
    ...(identifiers.length ? {
      userData: freeze({ userIdentifiers: freeze(identifiers) }),
    } : {}),
    consent: freeze({ adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_DENIED" }),
  });
}

function skipped(reason: GoogleDataManagerSkippedReason): GoogleDataManagerEligibilityResult {
  return freeze({ outcome: "skipped", reason });
}

export function evaluateGoogleDataManagerEligibility(
  input: GoogleDataManagerEligibilityInput,
): GoogleDataManagerEligibilityResult {
  if (!input.manualConversionsEnabled || !input.googleManualConversionsEnabled) {
    return freeze({ outcome: "disabled", reason: "feature_disabled" });
  }
  if (input.consent === "denied") return skipped("consent_denied");
  if (input.consent !== "granted") return skipped("consent_unknown");
  if (!isValidActivation(input.activationAt)) return skipped("invalid_activation");
  if (!validDate(input.orderCreatedAt)) return skipped("missing_created_at");
  if (!validDate(input.manualPaymentConfirmedAt)) return skipped("missing_confirmed_at");
  const activatedAt = new Date(input.activationAt).getTime();
  if (input.orderCreatedAt.getTime() < activatedAt) return skipped("historical_order");
  if (input.manualPaymentConfirmedAt.getTime() < activatedAt) return skipped("before_activation");
  if (!input.previousPaymentStatus?.trim()
    || input.previousPaymentStatus === "paid"
    || input.currentPaymentStatus !== "paid") {
    return skipped("not_paid_transition");
  }
  if (input.priorDeliveryState === "succeeded") return skipped("already_delivered");
  if (!TRANSACTION_ID_PATTERN.test(input.transactionId)) return skipped("invalid_transaction_id");
  const event = buildGoogleDataManagerEvent(input);
  if (!event) {
    if (!normalizeCurrency(input.currency)) return skipped("invalid_currency");
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) return skipped("invalid_value");
    return skipped("no_identifier");
  }
  if (!event.adIdentifiers && !event.userData) return skipped("no_identifier");
  if (!input.hasDurableDeliveryStore) return freeze({ outcome: "blocked_no_durable_store" });
  return freeze({ outcome: "ready", event });
}
