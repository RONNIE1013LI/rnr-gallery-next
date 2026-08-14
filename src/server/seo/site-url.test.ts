import { describe, expect, it } from "vitest";
import { getSiteUrl } from "./site-url";

describe("site URL", () => {
  it("uses the configured application origin without paths or credentials", () => {
    expect(getSiteUrl({ BETTER_AUTH_URL: "https://shop.example.test/" }).toString())
      .toBe("https://shop.example.test/");
  });

  it.each([
    "javascript:alert(1)",
    "https://user:secret@example.test",
    "https://example.test/not-an-origin",
  ])("falls back safely for invalid configured URL %s", (BETTER_AUTH_URL) => {
    expect(getSiteUrl({ BETTER_AUTH_URL }).toString()).toBe("https://rnrgallery.com/");
  });
});
