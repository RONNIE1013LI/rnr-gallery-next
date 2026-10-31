import { z } from "zod";

export const REVIEW_FONTS = {
  default: { label: "Website default", family: "var(--font-body, Arial, Helvetica, sans-serif)" },
  arial: { label: "Arial", family: "Arial, Helvetica, sans-serif" },
  georgia: { label: "Georgia", family: 'Georgia, "Times New Roman", serif' },
  verdana: { label: "Verdana", family: "Verdana, Geneva, sans-serif" },
} as const;

export const reviewCharacterStyleSchema = z.object({
  font: z.enum(["default", "arial", "georgia", "verdana"]),
  size: z.number().int().min(12).max(32),
  bold: z.boolean(),
  italic: z.boolean(),
}).strict();

export type ReviewCharacterStyle = z.infer<typeof reviewCharacterStyleSchema>;
const rangeSchema = reviewCharacterStyleSchema.extend({
  from: z.number().int().min(0).max(10_000),
  to: z.number().int().min(1).max(10_000),
}).strict().refine((range) => range.to > range.from, "Choose a non-empty text range");

export const reviewTextStyleSchema = reviewCharacterStyleSchema.extend({
  ranges: z.array(rangeSchema).max(10_000).optional(),
}).strict().superRefine((style, context) => {
  let end = 0;
  for (const range of style.ranges ?? []) {
    if (range.from < end) context.addIssue({ code: "custom", path: ["ranges"], message: "Text formatting ranges must not overlap" });
    end = range.to;
  }
});

export type ReviewTextStyle = z.infer<typeof reviewTextStyleSchema>;
export const DEFAULT_REVIEW_TEXT_STYLE: ReviewTextStyle = { font: "default", size: 16, bold: false, italic: false };

export function reviewTextCss(value?: ReviewTextStyle) {
  const parsed = reviewTextStyleSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const style = parsed.data;
  return {
    fontFamily: REVIEW_FONTS[style.font].family,
    fontSize: `${style.size}px`,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    lineHeight: 1.65,
  } as const;
}

export function decodeReviewTextStyle(value: string | null | undefined): ReviewTextStyle | undefined {
  if (!value) return undefined;
  try {
    const parsed = reviewTextStyleSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function reviewTextSegments(text: string, style?: ReviewTextStyle) {
  const base = reviewCharacterStyleSchema.parse(style ? {
    font: style.font, size: style.size, bold: style.bold, italic: style.italic,
  } : DEFAULT_REVIEW_TEXT_STYLE);
  const segments: { text: string; style: ReviewCharacterStyle }[] = [];
  let offset = 0;
  const parsed = reviewTextStyleSchema.safeParse(style);
  for (const range of parsed.success ? parsed.data.ranges ?? [] : []) {
    if (range.to > text.length) continue;
    if (range.from > offset) segments.push({ text: text.slice(offset, range.from), style: base });
    const { font, size, bold, italic } = range;
    segments.push({ text: text.slice(range.from, range.to), style: { font, size, bold, italic } });
    offset = range.to;
  }
  if (offset < text.length) segments.push({ text: text.slice(offset), style: base });
  return segments;
}
