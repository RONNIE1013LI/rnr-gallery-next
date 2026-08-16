import { describe, expect, it } from "vitest";
import { runtime, maxDuration } from "./route";

describe("Meta webhook route runtime", () => {
  it("uses the Node runtime with bounded execution", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(30);
  });
});
