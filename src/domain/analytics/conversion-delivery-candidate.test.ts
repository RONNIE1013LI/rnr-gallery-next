import { describe, expect, it } from "vitest";
import {
  buildConversionDeliveryCandidates,
  parseConversionActivationPolicy,
} from "./conversion-delivery-candidate";

const jobId = "11111111-1111-4111-8111-111111111111";
const activation = new Date("2026-08-01T00:00:00.000Z");
const base = {
  jobId,
  source: "manual" as const,
  createdAt: new Date("2026-08-02T00:00:00.000Z"),
  confirmedAt: new Date("2026-08-03T00:00:00.000Z"),
  customerSource: "messenger",
  customerEmail: "Test@example.test",
  customerPhone: "+64 21 123 4567",
  manualPaymentStatus: "paid",
  amountPaidCents: 20_000,
  linkedOnlineOrder: false,
  invoice: { authoritative: true, status: "issued", currency: "NZD", totalInclGstCents: 20_000 },
  customFields: {
    advertising_consent: "granted",
    advertising_consent_recorded_at: "2026-08-02T03:00:00.000Z",
    advertising_source: "messenger",
    fbp: "fb.1.1720000000000.123456789",
  },
};

describe("conversion delivery candidates", () => {
  it("requires an enabled platform, valid activation and recorded granted consent", () => {
    expect(buildConversionDeliveryCandidates(base, {
      google: { enabled: false, activatedAt: null },
      meta: { enabled: false, activatedAt: null },
    })).toEqual([]);
    expect(buildConversionDeliveryCandidates({
      ...base,
      customFields: { ...base.customFields, advertising_consent: "denied" },
    }, {
      google: { enabled: false, activatedAt: null },
      meta: { enabled: true, activatedAt: activation },
    })).toEqual([]);
    expect(buildConversionDeliveryCandidates({
      ...base,
      customFields: { ...base.customFields, advertising_consent_recorded_at: "" },
    }, {
      google: { enabled: false, activatedAt: null },
      meta: { enabled: true, activatedAt: activation },
    })).toEqual([]);
    expect(buildConversionDeliveryCandidates({
      ...base,
      customFields: {
        ...base.customFields,
        advertising_consent_recorded_at: "2026-08-03T00:00:00.001Z",
      },
    }, {
      google: { enabled: false, activatedAt: null },
      meta: { enabled: true, activatedAt: activation },
    })).toEqual([]);
  });

  it("creates a minimal immutable Meta snapshot using stable job identity", () => {
    const rows = buildConversionDeliveryCandidates(base, {
      google: { enabled: false, activatedAt: null },
      meta: { enabled: true, activatedAt: activation },
    });
    expect(rows).toEqual([expect.objectContaining({
      platform: "meta",
      transactionId: `manual-order:${jobId}`,
      jobId,
      eventOccurredAt: base.confirmedAt,
      currency: "NZD",
      valueMinor: 20_000,
      consentSnapshot: expect.objectContaining({ decision: "granted" }),
      attributionSnapshot: expect.objectContaining({ source: "meta", fbp: base.customFields.fbp }),
      userDataSnapshot: expect.objectContaining({
        hashedEmail: expect.stringMatching(/^[a-f0-9]{64}$/),
        hashedPhone: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    })]);
    expect(JSON.stringify(rows)).not.toMatch(/Test@example|123 4567|address|photo|artwork/i);
  });

  it("supports Google click attribution and NZD/AUD without conversion", () => {
    const rows = buildConversionDeliveryCandidates({
      ...base,
      customerSource: "web",
      invoice: { authoritative: true, status: "issued", currency: "AUD", totalInclGstCents: 20_000 },
      customFields: {
        advertising_consent: "granted",
        advertising_consent_recorded_at: "2026-08-02T03:00:00.000Z",
        advertising_source: "google",
        gclid: "test-click-id_123",
      },
    }, {
      google: { enabled: true, activatedAt: activation },
      meta: { enabled: false, activatedAt: null },
    });
    expect(rows).toEqual([expect.objectContaining({
      platform: "google",
      currency: "AUD",
      valueMinor: 20_000,
      attributionSnapshot: expect.objectContaining({ gclid: "test-click-id_123" }),
    })]);
  });

  it.each([
    ["historical order", { createdAt: new Date("2026-07-31T23:59:59.000Z") }],
    ["historical payment", { confirmedAt: new Date("2026-07-31T23:59:59.000Z") }],
    ["non-paid", { manualPaymentStatus: "processing" }],
    ["online-linked", { linkedOnlineOrder: true }],
    ["amount mismatch", { amountPaidCents: 19_999 }],
    ["non-authoritative amount snapshot", { invoice: { ...base.invoice, authoritative: false } }],
  ])("rejects %s", (_label, override) => {
    expect(buildConversionDeliveryCandidates({ ...base, ...override }, {
      google: { enabled: false, activatedAt: null },
      meta: { enabled: true, activatedAt: activation },
    })).toEqual([]);
  });

  it("parses fail-closed runtime activation policy", () => {
    expect(parseConversionActivationPolicy({
      MANUAL_OFFLINE_CONVERSIONS_ENABLED: "true",
      GOOGLE_MANUAL_CONVERSIONS_ENABLED: "true",
      GOOGLE_MANUAL_CONVERSIONS_ACTIVATED_AT: "2026-08-01T00:00:00.000Z",
      META_MANUAL_CONVERSIONS_ENABLED: "false",
      META_MANUAL_CONVERSIONS_ACTIVATED_AT: "2026-08-01T00:00:00.000Z",
    })).toEqual({
      google: { enabled: true, activatedAt: activation },
      meta: { enabled: false, activatedAt: null },
    });
    expect(parseConversionActivationPolicy({
      MANUAL_OFFLINE_CONVERSIONS_ENABLED: "true",
      GOOGLE_MANUAL_CONVERSIONS_ENABLED: "true",
      GOOGLE_MANUAL_CONVERSIONS_ACTIVATED_AT: "invalid",
    }).google).toEqual({ enabled: false, activatedAt: null });
  });
});
