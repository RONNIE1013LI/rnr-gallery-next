import { describe, expect, it } from "vitest";
import {
  nextOrderPaymentStatus,
  verifiedIncomingStatus,
} from "./state-machine";

describe("payment state transitions", () => {
  it.each([
    ["awaiting_payment", "processing", "processing"],
    ["processing", "paid", "paid"],
    ["paid", "failed", "paid"],
    ["failed", "processing", "processing"],
    ["cancelled", "processing", "processing"],
    ["refunded", "processing", "refunded"],
    ["refunded", "paid", "refunded"],
  ] as const)("%s + %s => %s", (current, incoming, expected) => {
    expect(nextOrderPaymentStatus(current, incoming)).toBe(expected);
  });

  it("does not trust a browser return that claims payment succeeded", () => {
    expect(verifiedIncomingStatus("browser_return", "paid")).toBe("processing");
  });

  it.each([
    "server_capture",
    "verified_webhook",
    "reconciliation",
  ] as const)("accepts paid from the trusted %s path", (source) => {
    expect(verifiedIncomingStatus(source, "paid")).toBe("paid");
  });

  it("accepts a trusted paid result after cancellation", () => {
    const trustedPaid = verifiedIncomingStatus("verified_webhook", "paid");

    expect(nextOrderPaymentStatus("cancelled", trustedPaid)).toBe("paid");
  });

  it("turns an untrusted paid return into a retryable processing state", () => {
    const browserStatus = verifiedIncomingStatus("browser_return", "paid");

    expect(browserStatus).toBe("processing");
    expect(nextOrderPaymentStatus("cancelled", browserStatus)).toBe("processing");
  });

  it.each(["processing", "failed", "cancelled"] as const)(
    "does not regress a paid order to %s",
    (incoming) => {
      expect(nextOrderPaymentStatus("paid", incoming)).toBe("paid");
    },
  );
});
