import { describe, expect, it } from "vitest";
import {
  buildManualConversionCandidates,
  MANUAL_ATTRIBUTION_FIELD_KEYS,
  type ManualConversionSnapshot,
} from "./manual-order-attribution";

const snapshot: ManualConversionSnapshot = {
  source: "manual",
  customerSource: "messenger",
  jobNumber: "RRM-2026-ATTRIBUTION",
  manualPaymentStatus: "paid",
  paidAt: new Date("2026-08-28T01:02:03.000Z"),
  amountPaidCents: 12_345,
  linkedOnlineOrder: false,
  invoice: { status: "issued", currency: "AUD", totalInclGstCents: 12_345 },
  metaMatching: {
    hashedEmail: "e233d4a29013e9d87150c6237c6777bedf379ebf1acdc5d6126fec7e8bb74fb5",
    hashedPhone: "222e24d90b23ba2af558a2891bfa399f19a7eb9f33df34a7d6809b97c5a97246",
  },
  customFields: {
    advertising_consent: "granted",
    advertising_consent_recorded_at: "2026-08-28T00:00:00.000Z",
    advertising_source: "messenger",
    fbclid: "meta_click-123",
    fbp: "fb.1.1787900000000.123456789",
    fbc: "fb.1.1787900000000.click_ABC-123",
  },
};

describe("manual conversion candidates", () => {
  it("exports only the server-owned attribution field allowlist", () => {
    expect(MANUAL_ATTRIBUTION_FIELD_KEYS).toEqual([
      "advertising_consent",
      "advertising_consent_recorded_at",
      "advertising_source",
      "fbclid",
      "fbp",
      "fbc",
      "gclid",
      "gbraid",
      "wbraid",
    ]);
  });

  it("builds a Meta-first candidate from explicit consent, issued invoice and Meta evidence", () => {
    expect(buildManualConversionCandidates(snapshot)).toEqual([{
      destination: "meta",
      transactionId: "manual:RRM-2026-ATTRIBUTION",
      paidAt: new Date("2026-08-28T01:02:03.000Z"),
      currency: "AUD",
      value: 123.45,
      meta: {
        actionSource: "business_messaging",
        fbp: "fb.1.1787900000000.123456789",
        fbc: "fb.1.1787900000000.click_ABC-123",
        hashedEmail: "e233d4a29013e9d87150c6237c6777bedf379ebf1acdc5d6126fec7e8bb74fb5",
        hashedPhone: "222e24d90b23ba2af558a2891bfa399f19a7eb9f33df34a7d6809b97c5a97246",
      },
    }]);
  });

  it("treats the typed manual Messenger, Instagram and WhatsApp source as Meta evidence but never as consent", () => {
    for (const customerSource of ["messenger", "instagram", "whatsapp"] as const) {
      expect(buildManualConversionCandidates({
        ...snapshot,
        customerSource,
        customFields: {
          advertising_consent: "granted",
          advertising_consent_recorded_at: "2026-08-28T00:00:00.000Z",
        },
      })[0]).toMatchObject({ destination: "meta" });
      expect(buildManualConversionCandidates({
        ...snapshot,
        customerSource,
        customFields: {},
      })).toEqual([]);
    }
  });

  it("builds Google only from exactly one valid Google click identifier", () => {
    expect(buildManualConversionCandidates({
      ...snapshot,
      customFields: {
        advertising_consent: "granted",
        advertising_consent_recorded_at: "2026-08-28T00:00:00.000Z",
        advertising_source: "google",
        gclid: "google-click_123",
      },
    })).toEqual([{
      destination: "google",
      transactionId: "manual:RRM-2026-ATTRIBUTION",
      paidAt: new Date("2026-08-28T01:02:03.000Z"),
      currency: "AUD",
      value: 123.45,
      google: { clickId: "google-click_123", kind: "gclid" },
    }]);
  });

  it.each([
    ["missing consent", { ...snapshot, customFields: { ...snapshot.customFields, advertising_consent: "" } }],
    ["denied consent", { ...snapshot, customFields: { ...snapshot.customFields, advertising_consent: "denied" } }],
    ["invalid recorded consent time", { ...snapshot, customFields: { ...snapshot.customFields, advertising_consent_recorded_at: "not-a-date" } }],
    ["missing authoritative paid time", { ...snapshot, paidAt: null }],
    ["invalid authoritative paid time", { ...snapshot, paidAt: new Date("invalid") }],
    ["web job", { ...snapshot, source: "web" as const }],
    ["unpaid payment", { ...snapshot, manualPaymentStatus: "awaiting_payment" }],
    ["refunded payment", { ...snapshot, manualPaymentStatus: "refunded" }],
    ["zero payment", { ...snapshot, amountPaidCents: 0, invoice: { ...snapshot.invoice!, totalInclGstCents: 0 } }],
    ["missing invoice", { ...snapshot, invoice: null }],
    ["draft invoice", { ...snapshot, invoice: { ...snapshot.invoice!, status: "draft" as const } }],
    ["invoice mismatch", { ...snapshot, invoice: { ...snapshot.invoice!, totalInclGstCents: 12_344 } }],
    ["unsupported invoice currency", { ...snapshot, invoice: { ...snapshot.invoice!, currency: "USD" } }],
    ["linked online order", { ...snapshot, linkedOnlineOrder: true }],
  ] as const)("suppresses %s", (_reason, invalid) => {
    expect(buildManualConversionCandidates(invalid)).toEqual([]);
  });

  it("fails closed for conflicting Meta and Google evidence unless the explicit source resolves it", () => {
    const conflicting = {
      ...snapshot,
      customFields: {
        ...snapshot.customFields,
        advertising_source: "other",
        gclid: "google-click_123",
      },
    };
    expect(buildManualConversionCandidates(conflicting)).toEqual([]);
    expect(buildManualConversionCandidates({
      ...conflicting,
      customFields: { ...conflicting.customFields, advertising_source: "google" },
    })[0]).toMatchObject({ destination: "google" });
  });

  it("uses consent-gated pre-hashed matching without exposing raw customer data", () => {
    const candidates = buildManualConversionCandidates({
      ...snapshot,
      customFields: {
        ...snapshot.customFields,
        customer_email: "customer@example.com",
        customer_phone: "+64 21 023 48948",
      },
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      destination: "meta",
      meta: {
        hashedEmail: "e233d4a29013e9d87150c6237c6777bedf379ebf1acdc5d6126fec7e8bb74fb5",
        hashedPhone: "222e24d90b23ba2af558a2891bfa399f19a7eb9f33df34a7d6809b97c5a97246",
      },
    });
    expect(JSON.stringify(candidates)).not.toMatch(/customer@example|\+64 21|02102348948/i);
  });

  it("fails closed when a Meta route has no CAPI matching identifier", () => {
    expect(buildManualConversionCandidates({
      ...snapshot,
      metaMatching: {},
      customFields: {
        advertising_consent: "granted",
        advertising_consent_recorded_at: "2026-08-28T00:00:00.000Z",
        advertising_source: "messenger",
        fbclid: "meta_click-123",
      },
    })).toEqual([]);
  });

  it("rejects malformed pre-hashed matching values", () => {
    expect(buildManualConversionCandidates({
      ...snapshot,
      metaMatching: { hashedEmail: "not-a-sha256" },
    })).toEqual([]);
  });

  it("rejects malformed identifiers", () => {
    expect(buildManualConversionCandidates({
      ...snapshot,
      customFields: {
        ...snapshot.customFields,
        advertising_source: "google",
        gclid: "not valid",
      },
    })).toEqual([]);
  });

  it("uses only immutable jobNumber for a stable repeated-save transaction id", () => {
    const later = { ...snapshot, amountPaidCents: 12_345, invoice: { ...snapshot.invoice! } };
    expect(buildManualConversionCandidates(snapshot)[0]?.transactionId)
      .toBe("manual:RRM-2026-ATTRIBUTION");
    expect(buildManualConversionCandidates(later)[0]?.transactionId)
      .toBe("manual:RRM-2026-ATTRIBUTION");
  });
});
