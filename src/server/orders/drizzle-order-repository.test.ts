import { describe, expect, it } from "vitest";
import { calculateOrderTotals } from "./drizzle-order-repository";

describe("atomic order totals", () => {
  it("rejects a safe product and shipping sum that overflows safe cents", () => {
    expect(() => calculateOrderTotals({
      subtotalExGstCents: Number.MAX_SAFE_INTEGER - 10,
      gstCents: 5,
      totalInclGstCents: Number.MAX_SAFE_INTEGER - 5,
    }, {
      shippingExGstCents: 20,
      shippingGstCents: 3,
      shippingTotalInclGstCents: 23,
    })).toThrow("safe integer cents");
  });
});
