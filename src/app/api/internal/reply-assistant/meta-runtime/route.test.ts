import { describe, expect, it } from "vitest";
import { maxDuration, runtime } from "./route";

describe("Meta runtime route", () => {
  it("uses a bounded Node runtime", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(30);
  });
});
