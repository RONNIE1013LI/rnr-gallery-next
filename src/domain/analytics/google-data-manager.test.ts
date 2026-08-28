import { describe, expect, it } from "vitest";

import {
  buildGoogleDataManagerEvent,
  evaluateGoogleDataManagerEligibility,
  hashGoogleEmail,
  hashGooglePhone,
  mapGoogleAdIdentifiers,
  mapGoogleEventSource,
  normalizeGoogleEmail,
  normalizeGooglePhone,
  toGoogleConversionValue,
} from "./google-data-manager";

const confirmedAt = new Date("2026-09-02T10:15:30.000Z");
const activationAt = "2026-09-01T00:00:00Z";

const validInput = {
  transactionId: "manual:JOB-2026-001",
  manualPaymentConfirmedAt: confirmedAt,
  currency: "nzd",
  amountMinor: 12_345,
  source: "website checkout",
  attribution: { gclid: "fake-gclid-001" },
  email: " Alice . Example @ Example . Com ",
  consent: "granted" as const,
};

const eligibleInput = {
  ...validInput,
  manualConversionsEnabled: true,
  googleManualConversionsEnabled: true,
  activationAt,
  orderCreatedAt: new Date("2026-09-01T00:00:00.000Z"),
  previousPaymentStatus: "awaiting_payment",
  currentPaymentStatus: "paid",
  priorDeliveryState: "pending" as const,
  hasDurableDeliveryStore: true,
};

describe("Google Data Manager event domain", () => {
  it("builds an immutable endpoint-independent event with a stable transaction ID", () => {
    const first = buildGoogleDataManagerEvent(validInput);
    const retry = buildGoogleDataManagerEvent(validInput);

    expect(first).toEqual({
      transactionId: "manual:JOB-2026-001",
      eventTimestamp: "2026-09-02T10:15:30.000Z",
      conversionValue: 123.45,
      currency: "NZD",
      eventSource: "WEB",
      adIdentifiers: { gclid: "fake-gclid-001" },
      userData: {
        userIdentifiers: [
          { emailAddress: "80b6856c17f72c11c8470ea0281111871f41331eb4ecee1f9910ac4b7c4c7209" },
        ],
      },
      consent: {
        adUserData: "CONSENT_GRANTED",
        adPersonalization: "CONSENT_DENIED",
      },
    });
    expect(retry?.transactionId).toBe(first?.transactionId);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.adIdentifiers)).toBe(true);
    expect(Object.isFrozen(first?.userData)).toBe(true);
    expect(Object.isFrozen(first?.userData?.userIdentifiers)).toBe(true);
    expect(Object.isFrozen(first?.userData?.userIdentifiers[0])).toBe(true);
    expect(Object.isFrozen(first?.consent)).toBe(true);
  });

  it("uses only NZD or AUD and converts safe integer minor units without drift", () => {
    expect(toGoogleConversionValue(12_345, "nzd")).toEqual({ currency: "NZD", conversionValue: 123.45 });
    expect(toGoogleConversionValue(99, "AUD")).toEqual({ currency: "AUD", conversionValue: 0.99 });
    expect(toGoogleConversionValue(-1, "NZD")).toBeNull();
    expect(toGoogleConversionValue(1.5, "NZD")).toBeNull();
    expect(toGoogleConversionValue(Number.POSITIVE_INFINITY, "NZD")).toBeNull();
    expect(toGoogleConversionValue(100, "USD")).toBeNull();
  });

  it("maps the real manual source channel without using the unspecified source", () => {
    expect(mapGoogleEventSource("website form")).toBe("WEB");
    expect(mapGoogleEventSource("Messenger")).toBe("MESSAGE");
    expect(mapGoogleEventSource("phone order")).toBe("PHONE");
    expect(mapGoogleEventSource("walk-in referral")).toBe("OTHER");
  });

  it("maps exactly one valid Google click identifier and rejects competing or malformed values", () => {
    expect(mapGoogleAdIdentifiers({ gclid: "fake-gclid-001" })).toEqual({ gclid: "fake-gclid-001" });
    expect(mapGoogleAdIdentifiers({ gbraid: "fake-gbraid-001" })).toEqual({ gbraid: "fake-gbraid-001" });
    expect(mapGoogleAdIdentifiers({ wbraid: "fake-wbraid-001" })).toEqual({ wbraid: "fake-wbraid-001" });
    expect(mapGoogleAdIdentifiers({ gclid: "fake-gclid-001", gbraid: "fake-gbraid-001" })).toBeNull();
    expect(mapGoogleAdIdentifiers({ gclid: "fake click id" })).toBeNull();
    expect(mapGoogleAdIdentifiers({ dclid: "fake-dclid-001" } as never)).toBeNull();
    expect(mapGoogleAdIdentifiers({})).toBeNull();
  });

  it("normalizes and hashes only valid synthetic email and E.164 phone user data", () => {
    expect(normalizeGoogleEmail(" Alice . Example + receipt @ Example . Com ")).toBe("alice.example+receipt@example.com");
    expect(normalizeGoogleEmail("cloudy.sanfrancisco+shopping@gmail.com")).toBe("cloudysanfrancisco@gmail.com");
    expect(normalizeGoogleEmail(" Alice . Example @ Example . Com ")).toBe("alice.example@example.com");
    expect(normalizeGoogleEmail("not an email")).toBeNull();
    expect(normalizeGooglePhone(" +1 (999) 555-0123 ")).toBe("+19995550123");
    expect(normalizeGooglePhone("19995550123")).toBeNull();
    expect(normalizeGooglePhone("+0123456789")).toBeNull();
    expect(hashGoogleEmail(" alice . example @ example . com ")).toBe("80b6856c17f72c11c8470ea0281111871f41331eb4ecee1f9910ac4b7c4c7209");
    expect(hashGooglePhone("+1 999 555 0123")).toBe("c92d777a363ba3622927322a92e292efd468b1b49356dba9d6490a58494fb66e");
  });

  it("does not build an event with unknown or denied advertising consent", () => {
    expect(buildGoogleDataManagerEvent({ ...validInput, consent: "denied" })).toBeNull();
    expect(buildGoogleDataManagerEvent({ ...validInput, consent: "unknown" })).toBeNull();
    expect(buildGoogleDataManagerEvent({ ...validInput, consent: null })).toBeNull();
  });
});

describe("Google Data Manager future-only eligibility", () => {
  it("requires both feature flags before a future eligible event can proceed", () => {
    expect(evaluateGoogleDataManagerEligibility({ ...eligibleInput, manualConversionsEnabled: false }))
      .toEqual({ outcome: "disabled", reason: "feature_disabled" });
    expect(evaluateGoogleDataManagerEligibility({ ...eligibleInput, googleManualConversionsEnabled: false }))
      .toEqual({ outcome: "disabled", reason: "feature_disabled" });
  });

  it("requires a valid UTC activation time and creation/payment timestamps at its boundary", () => {
    expect(evaluateGoogleDataManagerEligibility({ ...eligibleInput, activationAt: undefined }))
      .toEqual({ outcome: "skipped", reason: "invalid_activation" });
    expect(evaluateGoogleDataManagerEligibility({ ...eligibleInput, activationAt: "2026-09-01T00:00:00+12:00" }))
      .toEqual({ outcome: "skipped", reason: "invalid_activation" });
    expect(evaluateGoogleDataManagerEligibility({ ...eligibleInput, orderCreatedAt: null }))
      .toEqual({ outcome: "skipped", reason: "missing_created_at" });
    expect(evaluateGoogleDataManagerEligibility({
      ...eligibleInput,
      orderCreatedAt: new Date("2026-08-31T23:59:59.999Z"),
    })).toEqual({ outcome: "skipped", reason: "historical_order" });
    expect(evaluateGoogleDataManagerEligibility({
      ...eligibleInput,
      manualPaymentConfirmedAt: new Date("2026-08-31T23:59:59.999Z"),
    })).toEqual({ outcome: "skipped", reason: "before_activation" });
    expect(evaluateGoogleDataManagerEligibility({
      ...eligibleInput,
      manualPaymentConfirmedAt: new Date("2026-09-01T00:00:00.000Z"),
    })).toMatchObject({ outcome: "ready" });
    expect(evaluateGoogleDataManagerEligibility({ ...eligibleInput, manualPaymentConfirmedAt: null }))
      .toEqual({ outcome: "skipped", reason: "missing_confirmed_at" });
  });

  it("requires a real transition to paid, explicit granted consent, matching evidence, and no successful delivery", () => {
    expect(evaluateGoogleDataManagerEligibility({ ...eligibleInput, previousPaymentStatus: "paid" }))
      .toEqual({ outcome: "skipped", reason: "not_paid_transition" });
    expect(evaluateGoogleDataManagerEligibility({ ...eligibleInput, currentPaymentStatus: "awaiting_payment" }))
      .toEqual({ outcome: "skipped", reason: "not_paid_transition" });
    expect(evaluateGoogleDataManagerEligibility({ ...eligibleInput, previousPaymentStatus: null }))
      .toEqual({ outcome: "skipped", reason: "not_paid_transition" });
    expect(evaluateGoogleDataManagerEligibility({ ...eligibleInput, consent: "denied" }))
      .toEqual({ outcome: "skipped", reason: "consent_denied" });
    expect(evaluateGoogleDataManagerEligibility({ ...eligibleInput, consent: "unknown" }))
      .toEqual({ outcome: "skipped", reason: "consent_unknown" });
    expect(evaluateGoogleDataManagerEligibility({ ...eligibleInput, consent: null }))
      .toEqual({ outcome: "skipped", reason: "consent_unknown" });
    expect(evaluateGoogleDataManagerEligibility({ ...eligibleInput, attribution: {}, email: undefined, phone: undefined }))
      .toEqual({ outcome: "skipped", reason: "no_identifier" });
    expect(evaluateGoogleDataManagerEligibility({ ...eligibleInput, priorDeliveryState: "succeeded" }))
      .toEqual({ outcome: "skipped", reason: "already_delivered" });
    expect(evaluateGoogleDataManagerEligibility({ ...eligibleInput, transactionId: "invalid transaction id" }))
      .toEqual({ outcome: "skipped", reason: "invalid_transaction_id" });
  });

  it("hard-blocks otherwise eligible events until durable delivery storage exists", () => {
    expect(evaluateGoogleDataManagerEligibility({ ...eligibleInput, hasDurableDeliveryStore: false }))
      .toEqual({ outcome: "blocked_no_durable_store" });
    expect(evaluateGoogleDataManagerEligibility(eligibleInput)).toMatchObject({
      outcome: "ready",
      event: {
        transactionId: "manual:JOB-2026-001",
        consent: { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_DENIED" },
      },
    });
  });
});
