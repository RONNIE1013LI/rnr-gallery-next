import { describe, expect, it } from "vitest";
import {
  assertReconciliationLimit,
  deriveProviderIdempotencyKey,
} from "./drizzle-payment-repository";

describe("payment repository helpers", () => {
  it("derives a stable versioned provider key without a browser UUID", () => {
    const input = {
      attemptId: "00000000-0000-4000-8000-000000000001",
      provider: "stripe" as const,
      operation: "create-session" as const,
    };

    expect(deriveProviderIdempotencyKey(input)).toBe(
      deriveProviderIdempotencyKey(input),
    );
    expect(deriveProviderIdempotencyKey(input)).toMatch(/^[a-f0-9]{64}$/);
    expect(
      deriveProviderIdempotencyKey({ ...input, operation: "complete" }),
    ).not.toBe(deriveProviderIdempotencyKey(input));
  });

  it.each([0, 51, -1, 1.5, Number.NaN])(
    "rejects invalid reconciliation limit %s",
    (limit) => {
      expect(() => assertReconciliationLimit(limit)).toThrow(
        "Reconciliation limit must be an integer from 1 to 50",
      );
    },
  );

  it.each([1, 50])("accepts reconciliation limit %s", (limit) => {
    expect(assertReconciliationLimit(limit)).toBe(limit);
  });
});
