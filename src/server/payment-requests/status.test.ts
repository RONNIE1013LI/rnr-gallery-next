import { describe, expect, it } from "vitest";
import { effectivePaymentRequestStatus, isPaymentRequestTransitionAllowed } from "./status";

describe("payment request status", () => {
  it("keeps a pending request payable after its historical deadline", () => {
    expect(effectivePaymentRequestStatus({
      status: "pending",
      expiresAt: new Date("2026-08-18T05:00:00.000Z"),
    })).toBe("pending");
  });

  it("allows only pending to move to a terminal state", () => {
    for (const status of ["paid", "expired", "cancelled", "invalidated"] as const) {
      expect(isPaymentRequestTransitionAllowed("pending", status)).toBe(true);
      expect(isPaymentRequestTransitionAllowed(status, "pending")).toBe(false);
    }
    expect(isPaymentRequestTransitionAllowed("paid", "cancelled")).toBe(false);
  });
});
