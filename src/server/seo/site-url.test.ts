import { describe, expect, it } from "vitest";
import { getSiteUrl } from "./site-url";

describe("site URL", () => {
  it("keeps public URLs on the single canonical production origin", () => {
    expect(getSiteUrl().toString()).toBe("https://rnrgallery.com/");
  });
});
