import { describe, expect, it } from "vitest";
import { inventoryTransition } from "./inventory-transition";

describe("supply stock lifecycle", () => {
  it("consumes a reservation without deducting available stock twice", () => {
    expect(inventoryTransition("reserved", "paid", false)).toEqual({ next: "consumed", stockDelta: "none" });
    expect(inventoryTransition("consumed", "paid", false)).toBeNull();
  });
  it.each(["failed", "cancelled"] as const)("releases %s once", (status) => {
    expect(inventoryTransition("reserved", status, false)).toEqual({ next: "released", stockDelta: "restore" });
    expect(inventoryTransition("released", status, false)).toBeNull();
  });
  it("reacquires late verified success following released stock", () => {
    expect(inventoryTransition("released", "paid", false)).toEqual({ next: "consumed", stockDelta: "reacquire" });
  });
  it("retries reacquiring a paid shortage after stock is replenished", () => {
    expect(inventoryTransition("consumed", "paid", false, true)).toEqual({ next: "consumed", stockDelta: "reacquire" });
  });
  it("restocks a refund once only while the order was never dispatched or completed", () => {
    expect(inventoryTransition("consumed", "refunded", true)).toEqual({ next: "restocked", stockDelta: "restore" });
    expect(inventoryTransition("restocked", "refunded", true)).toBeNull();
    expect(inventoryTransition("consumed", "refunded", false)).toBeNull();
  });
});

it("does not release retry B's held stock when an old attempt A fails again", () => {
  expect(inventoryTransition("reserved", "failed", false, false, { currentAttemptId: "B", incomingAttemptId: "A" })).toBeNull();
  expect(inventoryTransition("reserved", "cancelled", false, false, { currentAttemptId: "B", incomingAttemptId: "A" })).toBeNull();
});

it("requires staff review when late payment succeeds after an operational supplies cancellation", async () => {
  const { supplyPaymentNeedsHold } = await import("./inventory-transition");
  expect(supplyPaymentNeedsHold("paid", "cancelled", false)).toBe(true);
  expect(supplyPaymentNeedsHold("paid", "new", false)).toBe(false);
  expect(supplyPaymentNeedsHold("paid", "new", true)).toBe(true);
});
