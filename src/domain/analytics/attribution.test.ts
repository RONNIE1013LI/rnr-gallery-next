import { describe, expect, it } from "vitest";

import {
  buildStoredOrderAttribution,
  clearAttribution,
  getAttributionStorageKey,
  isOrderAttribution,
  parseAttribution,
  readAttribution,
  saveAttribution,
} from "./attribution";

describe("identity-scoped advertising attribution", () => {
  it("adds only server-owned consent and valid Meta cookies while legacy values remain flat", () => {
    const campaign = { utm_source: "facebook", fbclid: "click-1" } as const;
    expect(buildStoredOrderAttribution(campaign, null, {
      fbp: "fb.1.1787900000000.123456789",
    })).toEqual(campaign);
    expect(buildStoredOrderAttribution(campaign, {
      version: 1,
      analytics: false,
      advertising: true,
      decidedAt: "2026-08-28T00:00:00.000Z",
    }, {
      fbp: "fb.1.1787900000000.123456789",
      fbc: "fb.1.1787900000000.click_ABC-123",
    })).toEqual({
      ...campaign,
      measurement: {
        version: 1,
        advertisingConsent: true,
        decidedAt: "2026-08-28T00:00:00.000Z",
        fbp: "fb.1.1787900000000.123456789",
        fbc: "fb.1.1787900000000.click_ABC-123",
      },
    });
    expect(isOrderAttribution(campaign)).toBe(true);
  });

  it("records denial without retaining Meta identifiers", () => {
    expect(buildStoredOrderAttribution(null, {
      version: 1,
      analytics: true,
      advertising: false,
      decidedAt: "2026-08-28T00:00:00.000Z",
    }, {
      fbp: "fb.1.1787900000000.123456789",
      fbc: "fb.1.1787900000000.click_ABC-123",
    })).toEqual({
      measurement: {
        version: 1,
        advertisingConsent: false,
        decidedAt: "2026-08-28T00:00:00.000Z",
      },
    });
  });
  it("keeps Guest, User A and User B attribution isolated in one browser", () => {
    saveAttribution(sessionStorage, null, { utm_source: "facebook", fbclid: "guest-meta-click" });
    saveAttribution(sessionStorage, "user-a", { utm_source: "newsletter", utm_campaign: "winter" });
    saveAttribution(sessionStorage, "user-b", { gbraid: "user-b-click" });

    expect(readAttribution(sessionStorage, null)).toEqual({ utm_source: "facebook", fbclid: "guest-meta-click" });
    expect(readAttribution(sessionStorage, "user-a")).toEqual({ utm_source: "newsletter", utm_campaign: "winter" });
    expect(readAttribution(sessionStorage, "user-b")).toEqual({ gbraid: "user-b-click" });
    expect(getAttributionStorageKey("user-a")).not.toBe(getAttributionStorageKey("user-b"));
  });

  it("accepts only bounded campaign and click identifiers", () => {
    const params = new URLSearchParams({
      utm_source: " google ", utm_medium: "cpc", gclid: "click-1", fbclid: "meta-click-1",
      email: "customer@example.test", name: "Customer", design: "private-design",
      utm_campaign: "x".repeat(300),
    });

    expect(parseAttribution(params)).toEqual({
      utm_source: "google", utm_medium: "cpc", gclid: "click-1", fbclid: "meta-click-1",
    });
  });

  it("clears only the signed-out identity", () => {
    saveAttribution(sessionStorage, null, { utm_source: "guest" });
    saveAttribution(sessionStorage, "user-a", { utm_source: "user-a" });
    clearAttribution(sessionStorage, "user-a");
    expect(readAttribution(sessionStorage, "user-a")).toBeNull();
    expect(readAttribution(sessionStorage, null)).toEqual({ utm_source: "guest" });
  });
});
