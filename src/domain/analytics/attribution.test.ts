import { beforeEach, describe, expect, it } from "vitest";

import {
  buildStoredOrderAttribution,
  clearAttribution,
  getAttributionStorageKey,
  handoffGuestAttribution,
  isOrderAttribution,
  parseAttribution,
  readAttribution,
  saveAttribution,
} from "./attribution";

describe("identity-scoped advertising attribution", () => {
  beforeEach(() => sessionStorage.clear());

  it("excludes fbclid without consent while preserving UTM and Google click attribution", () => {
    const campaign = {
      utm_source: "facebook",
      gclid: "google-click-1",
      gbraid: "google-braid-1",
      wbraid: "google-web-braid-1",
      fbclid: "meta-click-1",
    } as const;
    expect(buildStoredOrderAttribution(campaign, null, {
      fbp: "fb.1.1787900000000.123456789",
    })).toEqual({
      utm_source: "facebook",
      gclid: "google-click-1",
      gbraid: "google-braid-1",
      wbraid: "google-web-braid-1",
    });
  });

  it("stores fbclid and valid Meta cookies only with granted advertising consent", () => {
    const campaign = { utm_source: "facebook", fbclid: "meta-click-1" } as const;
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

  it("records denial without retaining fbclid or Meta cookies", () => {
    expect(buildStoredOrderAttribution({
      utm_source: "facebook",
      gclid: "google-click-1",
      fbclid: "meta-click-1",
    }, {
      version: 1,
      analytics: true,
      advertising: false,
      decidedAt: "2026-08-28T00:00:00.000Z",
    }, {
      fbp: "fb.1.1787900000000.123456789",
      fbc: "fb.1.1787900000000.click_ABC-123",
    })).toEqual({
      utm_source: "facebook",
      gclid: "google-click-1",
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

  it.each([
    ["Google Ads", { gclid: "google-click", gbraid: "google-app", wbraid: "google-web" }],
    ["Meta Ads", { fbclid: "meta-click", utm_source: "facebook", utm_medium: "paid_social" }],
    ["UTM", { utm_source: "newsletter", utm_medium: "email", utm_campaign: "spring" }],
  ] as const)("hands validated %s attribution from Guest to the authenticated user", (_label, value) => {
    saveAttribution(sessionStorage, null, value);

    expect(handoffGuestAttribution(sessionStorage, "user-a")).toBe("transferred");
    expect(readAttribution(sessionStorage, "user-a")).toEqual(value);
    expect(readAttribution(sessionStorage, null)).toBeNull();
  });

  it("does nothing for a Direct Guest login", () => {
    expect(handoffGuestAttribution(sessionStorage, "user-a")).toBe("empty");
    expect(readAttribution(sessionStorage, "user-a")).toBeNull();
  });

  it("keeps stronger existing authenticated attribution and consumes stale Guest state", () => {
    saveAttribution(sessionStorage, null, { utm_source: "old-newsletter", fbclid: "stale-meta" });
    saveAttribution(sessionStorage, "user-a", { gclid: "existing-google" });

    expect(handoffGuestAttribution(sessionStorage, "user-a")).toBe("kept_existing");
    expect(readAttribution(sessionStorage, "user-a")).toEqual({ gclid: "existing-google" });
    expect(readAttribution(sessionStorage, null)).toBeNull();
  });

  it("never transfers malformed or unrelated Guest session state", () => {
    sessionStorage.setItem(getAttributionStorageKey(null), JSON.stringify({
      gclid: "valid-looking",
      cart: { private: true },
    }));
    sessionStorage.setItem("rnr:guest:cart", "private-cart");

    expect(handoffGuestAttribution(sessionStorage, "user-a")).toBe("invalid");
    expect(readAttribution(sessionStorage, "user-a")).toBeNull();
    expect(readAttribution(sessionStorage, null)).toBeNull();
    expect(sessionStorage.getItem("rnr:guest:cart")).toBe("private-cart");
  });
});
