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

  it.each(["processing", "failed", "cancelled"] as const)(
    "does not regress a paid order to %s",
    (incoming) => {
      expect(nextOrderPaymentStatus("paid", incoming)).toBe("paid");
    },
  );
});
