export const MANUAL_ATTRIBUTION_FIELD_KEYS = [
  "advertising_consent",
  "advertising_consent_recorded_at",
  "advertising_source",
  "fbclid",
  "fbp",
  "fbc",
  "gclid",
  "gbraid",
  "wbraid",
] as const;

type ManualAttributionFieldKey = typeof MANUAL_ATTRIBUTION_FIELD_KEYS[number];
type ManualCustomFields = Readonly<Record<string, string | undefined>>;

export type ManualConversionSnapshot = Readonly<{
  source: "manual" | "web";
  customerSource: string;
  jobNumber: string;
  manualPaymentStatus: string | null;
  amountPaidCents: number | null;
  linkedOnlineOrder: boolean;
  invoice: Readonly<{
    status: string;
    currency: string;
    totalInclGstCents: number;
  }> | null;
  customFields: ManualCustomFields;
}>;

export type ManualConversionCandidate = Readonly<{
  destination: "meta" | "google";
  transactionId: string;
  currency: "NZD" | "AUD";
  value: number;
  meta?: Readonly<{ fbclid?: string; fbp?: string; fbc?: string }>;
  google?: Readonly<{ clickId: string; kind: "gclid" | "gbraid" | "wbraid" }>;
}>;

const clickIdPattern = /^[A-Za-z0-9._~-]{1,200}$/;
const metaCookiePattern = /^fb\.1\.\d{10,13}\.[A-Za-z0-9._-]{1,200}$/;
const jobNumberPattern = /^[A-Za-z0-9-]{3,80}$/;
const recordedAtPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function fieldValues(fields: ManualCustomFields) {
  return Object.freeze(Object.fromEntries(MANUAL_ATTRIBUTION_FIELD_KEYS.map((key) => [
    key,
    fields[key]?.trim() ?? "",
  ])) as Record<ManualAttributionFieldKey, string>);
}

function hasRecordedGrantedConsent(fields: ReturnType<typeof fieldValues>) {
  if (fields.advertising_consent !== "granted"
    || !recordedAtPattern.test(fields.advertising_consent_recorded_at)) return false;
  return !Number.isNaN(Date.parse(fields.advertising_consent_recorded_at));
}

function declaredSource(value: string): "meta" | "google" | null {
  switch (value.trim().toLowerCase()) {
    case "meta":
    case "facebook":
    case "facebook_ads":
    case "messenger":
    case "instagram":
    case "whatsapp":
      return "meta";
    case "google":
    case "google_ads":
      return "google";
    default:
      return null;
  }
}

function isMetaCustomerSource(value: string) {
  return value === "messenger" || value === "instagram" || value === "whatsapp";
}

function isValidMoney(value: number | null): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function baseCandidate(snapshot: ManualConversionSnapshot): Omit<ManualConversionCandidate, "destination" | "meta" | "google"> | null {
  if (snapshot.source !== "manual"
    || !jobNumberPattern.test(snapshot.jobNumber)
    || snapshot.manualPaymentStatus !== "paid"
    || !isValidMoney(snapshot.amountPaidCents)
    || snapshot.linkedOnlineOrder
    || snapshot.invoice?.status !== "issued"
    || snapshot.invoice.totalInclGstCents !== snapshot.amountPaidCents
    || (snapshot.invoice.currency !== "NZD" && snapshot.invoice.currency !== "AUD")) return null;
  return Object.freeze({
    transactionId: `manual:${snapshot.jobNumber}`,
    currency: snapshot.invoice.currency,
    value: snapshot.invoice.totalInclGstCents / 100,
  });
}

function metaEvidence(fields: ReturnType<typeof fieldValues>) {
  const values = {
    ...(fields.fbclid ? { fbclid: fields.fbclid } : {}),
    ...(fields.fbp ? { fbp: fields.fbp } : {}),
    ...(fields.fbc ? { fbc: fields.fbc } : {}),
  };
  if ((values.fbclid && !clickIdPattern.test(values.fbclid))
    || (values.fbp && !metaCookiePattern.test(values.fbp))
    || (values.fbc && !metaCookiePattern.test(values.fbc))) return null;
  return Object.freeze(values);
}

function googleEvidence(fields: ReturnType<typeof fieldValues>) {
  const raw = (["gclid", "gbraid", "wbraid"] as const)
    .filter((kind) => fields[kind])
    .map((kind) => ({ kind, clickId: fields[kind] }));
  if (raw.some((entry) => !clickIdPattern.test(entry.clickId)) || raw.length !== 1) return null;
  return Object.freeze(raw[0]);
}

export function buildManualConversionCandidates(
  snapshot: ManualConversionSnapshot,
): readonly ManualConversionCandidate[] {
  const base = baseCandidate(snapshot);
  const fields = fieldValues(snapshot.customFields);
  if (!base || !hasRecordedGrantedConsent(fields)) return Object.freeze([]);

  const meta = metaEvidence(fields);
  const google = googleEvidence(fields);
  const source = declaredSource(fields.advertising_source);
  const hasMetaEvidence = source === "meta"
    || isMetaCustomerSource(snapshot.customerSource)
    || Boolean(meta && Object.keys(meta).length);
  const hasGoogleEvidence = source === "google" || google !== null;
  if ((fields.fbclid || fields.fbp || fields.fbc) && !meta) return Object.freeze([]);
  if ((fields.gclid || fields.gbraid || fields.wbraid) && !google) return Object.freeze([]);
  if (hasMetaEvidence && hasGoogleEvidence && source === null) return Object.freeze([]);

  if (source === "meta" || (hasMetaEvidence && !hasGoogleEvidence)) {
    return Object.freeze([Object.freeze({ ...base, destination: "meta" as const, meta: meta ?? {} })]);
  }
  if (source === "google" || (hasGoogleEvidence && !hasMetaEvidence)) {
    if (!google) return Object.freeze([]);
    return Object.freeze([Object.freeze({ ...base, destination: "google" as const, google })]);
  }
  return Object.freeze([]);
}
