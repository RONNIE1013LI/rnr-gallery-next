import { describe, expect, it } from "vitest";

import {
  clearAttribution,
  getAttributionStorageKey,
  parseAttribution,
  readAttribution,
  saveAttribution,
} from "./attribution";

describe("identity-scoped advertising attribution", () => {
  it("keeps Guest, User A and User B attribution isolated in one browser", () => {
    saveAttribution(sessionStorage, null, { utm_source: "google", gclid: "guest-click" });
    saveAttribution(sessionStorage, "user-a", { utm_source: "newsletter", utm_campaign: "winter" });
    saveAttribution(sessionStorage, "user-b", { gbraid: "user-b-click" });

    expect(readAttribution(sessionStorage, null)).toEqual({ utm_source: "google", gclid: "guest-click" });
    expect(readAttribution(sessionStorage, "user-a")).toEqual({ utm_source: "newsletter", utm_campaign: "winter" });
    expect(readAttribution(sessionStorage, "user-b")).toEqual({ gbraid: "user-b-click" });
    expect(getAttributionStorageKey("user-a")).not.toBe(getAttributionStorageKey("user-b"));
  });

  it("accepts only bounded campaign and click identifiers", () => {
    const params = new URLSearchParams({
      utm_source: " google ", utm_medium: "cpc", gclid: "click-1",
      email: "customer@example.test", name: "Customer", design: "private-design",
      utm_campaign: "x".repeat(300),
    });

    expect(parseAttribution(params)).toEqual({
      utm_source: "google", utm_medium: "cpc", gclid: "click-1",
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
