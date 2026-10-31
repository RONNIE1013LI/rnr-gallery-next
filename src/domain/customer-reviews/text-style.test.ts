import { describe, expect, it } from "vitest";
import { decodeReviewTextStyle, reviewTextCss, reviewTextStyleSchema } from "./text-style";

describe("review typography", () => {
  it("accepts only bounded sizes and known fonts", () => {
    const style = { font: "georgia", size: 20, bold: true, italic: false };
    expect(decodeReviewTextStyle(JSON.stringify(style))).toEqual(style);
    for (const invalid of [{ ...style, size: 1000 }, { ...style, font: "url(https://example.test)" }, { ...style, color: "red" }]) {
      expect(reviewTextStyleSchema.safeParse(invalid).success).toBe(false);
      expect(decodeReviewTextStyle(JSON.stringify(invalid))).toBeUndefined();
    }
    expect(decodeReviewTextStyle("invalid JSON")).toBeUndefined();
    expect(reviewTextCss()).toBeUndefined();
  });
});
