import { describe, expect, it } from "vitest";
import { MANUAL_ATTRIBUTION_FIELD_KEYS } from "./manual-order-attribution";

describe("manual order attribution fields", () => {
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
});
