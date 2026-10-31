import { describe, expect, it } from "vitest";
import { reviewEditorDocument, reviewFromEditor } from "./rich-text";
import { DEFAULT_REVIEW_TEXT_STYLE } from "./text-style";

describe("review rich text", () => {
  it("round-trips original whitespace, emoji and selected formatting", () => {
    const text = "  Customer 😊\n\nFrom R&R: Thanks!\n";
    const from = text.indexOf("From");
    const style = { ...DEFAULT_REVIEW_TEXT_STYLE, ranges: [{ from, to: text.length - 1, font: "georgia" as const, size: 14, bold: true, italic: true }] };
    expect(reviewFromEditor(reviewEditorDocument(text, style))).toEqual({ text, textStyle: style });
  });
  it("keeps legacy whole-review styling and renders pasted markup as text", () => {
    const style = { font: "arial" as const, size: 20, bold: true, italic: false };
    const text = "<script>alert('x')</script>\n\nOriginal review";
    expect(reviewFromEditor(reviewEditorDocument(text, style), style)).toEqual({ text, textStyle: { ...style, ranges: [] } });
  });
});
