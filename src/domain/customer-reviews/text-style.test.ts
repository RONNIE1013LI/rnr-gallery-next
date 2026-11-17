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

it("preserves separate styles for selected text while keeping the words unchanged", async () => {
  const { reviewTextSegments } = await import("./text-style");
  const style = { font: "default" as const, size: 16, bold: false, italic: false,
    ranges: [{ from: 7, to: 12, font: "georgia" as const, size: 22, bold: true, italic: true }] };
  const segments = reviewTextSegments("Review Reply", style);
  expect(segments.map((segment) => segment.text).join("")).toBe("Review Reply");
  expect(segments[0].style.size).toBe(16);
  expect(segments[1]).toMatchObject({ text: "Reply", style: { size: 22, bold: true } });
  expect(decodeReviewTextStyle(JSON.stringify(style))).toEqual(style);
  expect(reviewTextStyleSchema.safeParse({ ...style, ranges: [{ ...style.ranges[0], from: 9, to: 2 }] }).success).toBe(false);
});

it.each([[0, 2], [2, 4]])("ignores a format range cutting an emoji at %i..%i", async (from, to) => {
  const { reviewTextSegments } = await import("./text-style");
  const base = { font: "default" as const, size: 16, bold: false, italic: false };
  expect(reviewTextSegments("A😊B", { ...base, ranges: [{ ...base, from, to, bold: true }] }))
    .toEqual([{ text: "A😊B", style: base }]);
});

it("keeps whole emoji and valid neighboring formatting unchanged", async () => {
  const { reviewTextSegments } = await import("./text-style");
  const base = { font: "default" as const, size: 16, bold: false, italic: false };
  const whole = reviewTextSegments("A😊B", { ...base, ranges: [{ ...base, from: 1, to: 3, bold: true }] });
  expect(whole[1]).toMatchObject({ text: "😊", style: { bold: true } });
  const adjacent = reviewTextSegments("A😊B", { ...base, ranges: [
    { ...base, from: 0, to: 2, italic: true },
    { ...base, from: 3, to: 4, bold: true },
  ] });
  expect(adjacent).toEqual([
    { text: "A😊", style: base },
    { text: "B", style: { ...base, bold: true } },
  ]);
});
