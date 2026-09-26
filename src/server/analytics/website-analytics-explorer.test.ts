import { describe, expect, it } from "vitest";
import { explorerOrderAcquisition } from "./website-analytics-explorer";

describe("analytics explorer evidence", () => {
  it("returns only consented order click evidence, never customer data or inferred session IDs", () => {
    expect(explorerOrderAcquisition({ gclid: "saved-google", email: "private", measurement: { advertisingConsent: false } }).clickIds).toEqual([]);
    expect(explorerOrderAcquisition({ gclid: "saved-google", fbclid: "saved-meta", fbc: "private-cookie", email: "private", measurement: { advertisingConsent: true } })).toEqual({
      clickIds: [{ type: "gclid", value: "saved-google" }, { type: "fbclid", value: "saved-meta" }],
      firstTouch: null, lastTouch: null, lastNonDirectTouch: null,
    });
  });
});
