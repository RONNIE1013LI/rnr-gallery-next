import { describe, expect, it } from "vitest";
import { estimateCostMicrousd, localDateScopeKey } from "./usage-cost";

describe("customer service usage cost", () => {
  it("charges cached and uncached input separately and rounds to micro USD", () => {
    expect(estimateCostMicrousd({
      model: "gpt-5.6-luna",
      inputTokens: 1_000,
      cachedInputTokens: 200,
      outputTokens: 100,
    })).toBe(284);
  });

  it("creates Pacific/Auckland daily scope keys", () => {
    expect(localDateScopeKey(new Date("2026-08-16T13:00:00.000Z"))).toBe("daily:2026-08-17");
  });
});
