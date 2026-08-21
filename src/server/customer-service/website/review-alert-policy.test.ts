import { describe, expect, it } from "vitest";
import { REVIEW_ALERT_AUTOMATIC_RECOVERY_MAX_AGE_MS } from "./review-alert-policy";

describe("website review alert recovery policy", () => {
  it("keeps automatic ambiguous-send recovery at a conservative 23-hour maximum", () => {
    expect(REVIEW_ALERT_AUTOMATIC_RECOVERY_MAX_AGE_MS).toBe(23 * 60 * 60 * 1_000);
    expect(REVIEW_ALERT_AUTOMATIC_RECOVERY_MAX_AGE_MS).toBeLessThan(24 * 60 * 60 * 1_000);
  });
});
