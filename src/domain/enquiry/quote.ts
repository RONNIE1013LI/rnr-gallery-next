import { z } from "zod";
import { products } from "@/domain/catalogue/products";

export const QUOTE_PHOTO_MAX_BYTES = 1024 * 1024;
export const QUOTE_MAX_PHOTOS = 3;
export const QUOTE_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;

const quoteSchema = z.object({
  requestId: z.string().uuid(),
  name: z.string().trim().min(1, "Enter your full name.").max(100, "Use no more than 100 characters."),
  contactMethod: z.enum(["email", "phone"]),
  email: z.string().trim().max(254),
  phone: z.string().trim().max(40),
  occasion: z.string().trim().max(100),
  product: z.string().refine((value) => value === "" || products.some((product) => product.active && product.key === value), "Choose a product or Not sure yet."),
  size: z.string().trim().max(100),
  requiredDate: z.string().max(10),
  message: z.string().trim().min(1, "Tell us what you have in mind.").max(1500, "Use no more than 1,500 characters."),
  website: z.literal(""),
}).strict().superRefine((value, context) => {
  if (value.contactMethod === "email" && !z.email().safeParse(value.email).success) {
    context.addIssue({ code: "custom", path: ["email"], message: "Enter a valid email address." });
  }
  if (value.contactMethod === "phone" && !/^\+?[\d ()-]{7,40}$/.test(value.phone)) {
    context.addIssue({ code: "custom", path: ["phone"], message: "Enter a phone number, including the country code." });
  }
});

export type QuoteInput = z.infer<typeof quoteSchema>;
export type QuoteErrors = Partial<Record<keyof QuoteInput | "photos", string>>;

export function parseQuote(value: unknown): { success: true; data: QuoteInput } | { success: false; errors: QuoteErrors } {
  const parsed = quoteSchema.safeParse(value);
  if (!parsed.success) {
    const errors: QuoteErrors = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "message") as keyof QuoteErrors;
      errors[field] ??= issue.message;
    }
    return { success: false, errors };
  }
  const date = parsed.data.requiredDate;
  const calendarDate = new Date(`${date}T00:00:00Z`);
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== date)) {
    return { success: false, errors: { requiredDate: "Enter a valid calendar date. Timing can be discussed with our team." } };
  }
  return { success: true, data: parsed.data };
}
