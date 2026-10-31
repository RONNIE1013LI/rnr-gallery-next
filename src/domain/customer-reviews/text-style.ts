import { z } from "zod";

export const REVIEW_FONTS = {
  default: { label: "Website default", family: "inherit" },
  arial: { label: "Arial", family: "Arial, Helvetica, sans-serif" },
  georgia: { label: "Georgia", family: 'Georgia, "Times New Roman", serif' },
  verdana: { label: "Verdana", family: "Verdana, Geneva, sans-serif" },
} as const;

export const reviewTextStyleSchema = z.object({
  font: z.enum(["default", "arial", "georgia", "verdana"]),
  size: z.number().int().min(12).max(32),
  bold: z.boolean(),
  italic: z.boolean(),
}).strict();

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
