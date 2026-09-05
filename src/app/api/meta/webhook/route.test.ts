import { describe, expect, it } from "vitest";
import { runtime, maxDuration } from "./route";

describe("Meta webhook route runtime", () => {
  it("uses the Node runtime with bounded execution", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(60);
  });

  it("exports only the webhook handlers from the route module", async () => {
    const route = await import("./route");
    expect(typeof route.GET).toBe("function");
    expect(typeof route.POST).toBe("function");
  });
});
