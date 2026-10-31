import type { JSONContent } from "@tiptap/core";
import { DEFAULT_REVIEW_TEXT_STYLE, reviewCharacterStyleSchema, reviewTextSegments, type ReviewCharacterStyle, type ReviewTextStyle } from "./text-style";

export function reviewEditorDocument(text: string, style?: ReviewTextStyle): JSONContent {
  const content: JSONContent[] = [];
  for (const segment of reviewTextSegments(text, style)) {
    const { font, size, bold, italic } = segment.style;
    const parts = segment.text.split("\n");
    parts.forEach((part, index) => {
      if (index) content.push({ type: "hardBreak" });
      if (part) content.push({ type: "text", text: part, marks: [{ type: "reviewStyle", attrs: { font, size, bold, italic } }] });
    });
  }
  return { type: "doc", content: [{ type: "paragraph", content }] };
}

function sameStyle(a: ReviewCharacterStyle, b: ReviewCharacterStyle) {
  return a.font === b.font && a.size === b.size && a.bold === b.bold && a.italic === b.italic;
}

export function reviewFromEditor(document: JSONContent, base: ReviewCharacterStyle = DEFAULT_REVIEW_TEXT_STYLE) {
  let text = "";
  const ranges: NonNullable<ReviewTextStyle["ranges"]> = [];
  function append(value: string, style: ReviewCharacterStyle) {
    const from = text.length;
    text += value;
    if (!value || sameStyle(style, base)) return;
    const previous = ranges.at(-1);
    if (previous && previous.to === from && sameStyle(previous, style)) previous.to = text.length;
    else ranges.push({ from, to: text.length, ...style });
  }
  (document.content ?? []).forEach((paragraph, index) => {
    if (index) append("\n", base);
    for (const node of paragraph.content ?? []) {
      if (node.type === "hardBreak") append("\n", base);
      if (node.type === "text") {
        const parsed = reviewCharacterStyleSchema.safeParse(node.marks?.find((mark) => mark.type === "reviewStyle")?.attrs);
        append(node.text ?? "", parsed.success ? parsed.data : base);
      }
    }
  });
  return { text, textStyle: { ...base, ranges } };
}
