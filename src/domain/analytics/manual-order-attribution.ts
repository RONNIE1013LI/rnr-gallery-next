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
  paidAt: Date | null;
  amountPaidCents: number | null;
  linkedOnlineOrder: boolean;
  invoice: Readonly<{
    status: string;
    currency: string;
    totalInclGstCents: number;
  }> | null;
  metaMatching: Readonly<{
    hashedEmail?: string;
    hashedPhone?: string;
  }>;
  customFields: ManualCustomFields;
}>;

export type ManualConversionCandidate = Readonly<{
  destination: "meta" | "google";
  transactionId: string;
  paidAt: Date;
  currency: "NZD" | "AUD";
  value: number;
  meta?: Readonly<{
    actionSource: "website" | "business_messaging";
    fbp?: string;
    fbc?: string;
    hashedEmail?: string;
    hashedPhone?: string;
  }>;
  google?: Readonly<{ clickId: string; kind: "gclid" | "gbraid" | "wbraid" }>;
}>;

const clickIdPattern = /^[A-Za-z0-9._~-]{1,200}$/;
const metaCookiePattern = /^fb\.1\.\d{10,13}\.[A-Za-z0-9._-]{1,200}$/;
const jobNumberPattern = /^[A-Za-z0-9-]{3,80}$/;
const hashPattern = /^[a-f0-9]{64}$/;
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

export function hasRecordedManualAdvertisingConsent(fields: ManualCustomFields) {
  return hasRecordedGrantedConsent(fieldValues(fields));
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
    || !(snapshot.paidAt instanceof Date)
    || Number.isNaN(snapshot.paidAt.getTime())
    || snapshot.paidAt.getTime() <= 0
    || !isValidMoney(snapshot.amountPaidCents)
    || snapshot.linkedOnlineOrder
    || snapshot.invoice?.status !== "issued"
    || snapshot.invoice.totalInclGstCents !== snapshot.amountPaidCents
    || (snapshot.invoice.currency !== "NZD" && snapshot.invoice.currency !== "AUD")) return null;
  return Object.freeze({
    transactionId: `manual:${snapshot.jobNumber}`,
    paidAt: new Date(snapshot.paidAt.getTime()),
    currency: snapshot.invoice.currency,
    value: snapshot.invoice.totalInclGstCents / 100,
  });
}

function metaEvidence(
  fields: ReturnType<typeof fieldValues>,
  matching: ManualConversionSnapshot["metaMatching"],
) {
  if ((matching.hashedEmail && !hashPattern.test(matching.hashedEmail))
    || (matching.hashedPhone && !hashPattern.test(matching.hashedPhone))) return null;
  const values = Object.freeze({
    ...(fields.fbp ? { fbp: fields.fbp } : {}),
    ...(fields.fbc ? { fbc: fields.fbc } : {}),
    ...(matching.hashedEmail ? { hashedEmail: matching.hashedEmail } : {}),
    ...(matching.hashedPhone ? { hashedPhone: matching.hashedPhone } : {}),
  });
  if ((fields.fbclid && !clickIdPattern.test(fields.fbclid))
    || (values.fbp && !metaCookiePattern.test(values.fbp))
    || (values.fbc && !metaCookiePattern.test(values.fbc))) return null;
  return Object.freeze({
    hasSourceEvidence: Boolean(fields.fbclid || fields.fbc),
    values,
  });
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
  const consentRecordedAt = new Date(fields.advertising_consent_recorded_at);
  if (!base
    || !hasRecordedGrantedConsent(fields)
    || consentRecordedAt > base.paidAt) return Object.freeze([]);

  const meta = metaEvidence(fields, snapshot.metaMatching);
  const google = googleEvidence(fields);
  const source = declaredSource(fields.advertising_source);
  const hasMetaEvidence = source === "meta"
    || isMetaCustomerSource(snapshot.customerSource)
    || Boolean(meta?.hasSourceEvidence);
  const hasGoogleEvidence = source === "google" || google !== null;
  if (!meta) return Object.freeze([]);
  if ((fields.gclid || fields.gbraid || fields.wbraid) && !google) return Object.freeze([]);
  if (meta.hasSourceEvidence && hasGoogleEvidence && source === null) return Object.freeze([]);

  if (source === "meta" || (hasMetaEvidence && !hasGoogleEvidence)) {
    if (Object.keys(meta.values).length === 0) return Object.freeze([]);
    const actionSource = isMetaCustomerSource(snapshot.customerSource)
      || ["messenger", "instagram", "whatsapp"].includes(fields.advertising_source)
      ? "business_messaging" as const
      : "website" as const;
    return Object.freeze([Object.freeze({
      ...base,
      destination: "meta" as const,
      meta: Object.freeze({ actionSource, ...meta.values }),
    })]);
  }
  if (source === "google" || (hasGoogleEvidence && !meta.hasSourceEvidence)) {
    if (!google) return Object.freeze([]);
    return Object.freeze([Object.freeze({ ...base, destination: "google" as const, google })]);
  }
  return Object.freeze([]);
}
