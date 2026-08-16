import { z } from "zod";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function validCalendarDate(value: string) {
  if (!isoDatePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

const invoiceItemSchema = z.object({
  code: z.string().trim().max(80).default(""),
  description: z.string().trim().min(1).max(500),
  quantityMilli: z.number().int().min(1).max(1_000_000),
  rateInclGstCents: z.number().int().min(0).max(100_000_000),
}).strict();

const invoiceDraftSchema = z.object({
  invoiceDate: z.string().refine(validCalendarDate),
  dueDate: z.string().refine(validCalendarDate),
  reference: z.string().trim().max(190).default(""),
  businessName: z.string().trim().max(190).default(""),
  businessAddress: z.string().trim().max(5_000).default(""),
  businessEmail: z.string().trim().toLowerCase().max(320).refine(
    (value) => value === "" || z.string().email().safeParse(value).success,
  ).default(""),
  businessPhone: z.string().trim().max(80).default(""),
  businessWebsite: z.string().trim().max(500).default(""),
  gstNumber: z.string().trim().max(100).default(""),
  bankAccount: z.string().trim().max(100).default(""),
  customerName: z.string().trim().min(1).max(190),
  customerEmail: z.string().trim().toLowerCase().max(320).refine(
    (value) => value === "" || z.string().email().safeParse(value).success,
  ),
  customerAddress: z.string().trim().max(5_000).default(""),
  deliveryAddress: z.string().trim().max(5_000).default(""),
  discountCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  notes: z.string().trim().max(10_000).default(""),
  terms: z.string().trim().max(10_000).default(""),
  items: z.array(invoiceItemSchema).min(1).max(100),
}).strict().superRefine((input, context) => {
  if (input.dueDate < input.invoiceDate) {
    context.addIssue({
      code: "custom",
      path: ["dueDate"],
      message: "Due date cannot be before invoice date",
    });
  }
  const grossCents = input.items.reduce(
    (sum, item) => sum + Math.round(item.quantityMilli * item.rateInclGstCents / 1_000),
    0,
  );
  if (!Number.isSafeInteger(grossCents) || input.discountCents > grossCents) {
    context.addIssue({
      code: "custom",
      path: ["discountCents"],
      message: "Discount cannot exceed the item total",
    });
  }
});

type ParsedInvoiceDraft = z.output<typeof invoiceDraftSchema>;
export type InvoiceDraft = Readonly<Omit<ParsedInvoiceDraft, "items"> & {
  items: readonly Readonly<ParsedInvoiceDraft["items"][number]>[];
}>;

export class InvoiceValidationError extends Error {
  constructor() {
    super("Invoice data is invalid");
    this.name = "InvoiceValidationError";
  }
}

export function parseInvoiceDraft(input: unknown): InvoiceDraft {
  const parsed = invoiceDraftSchema.safeParse(input);
  if (!parsed.success) throw new InvoiceValidationError();
  return Object.freeze({
    ...parsed.data,
    items: Object.freeze(parsed.data.items.map((item) => Object.freeze(item))),
  });
}

export function calculateInvoiceTotals(input: Readonly<{
  items: readonly Readonly<Pick<z.output<typeof invoiceItemSchema>, "quantityMilli" | "rateInclGstCents">>[];
  discountCents: number;
}>, taxRateBasisPoints = 1_500) {
  const grossCents = input.items.reduce(
    (sum, item) => sum + Math.round(item.quantityMilli * item.rateInclGstCents / 1_000),
    0,
  );
  const totalInclGstCents = grossCents - input.discountCents;
  if (
    !Number.isSafeInteger(grossCents) ||
    !Number.isSafeInteger(input.discountCents) ||
    input.discountCents < 0 ||
    totalInclGstCents < 0 ||
    !Number.isInteger(taxRateBasisPoints) ||
    taxRateBasisPoints < 0 ||
    taxRateBasisPoints > 10_000
  ) {
    throw new InvoiceValidationError();
  }
  const gstCents = Math.round(
    totalInclGstCents * taxRateBasisPoints / (10_000 + taxRateBasisPoints),
  );
  return Object.freeze({
    grossCents,
    discountCents: input.discountCents,
    subtotalExGstCents: totalInclGstCents - gstCents,
    gstCents,
    totalInclGstCents,
  });
}

export function buildInvoiceNumber(jobNumber: string) {
  const normalized = jobNumber.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{2,79}$/.test(normalized)) {
    throw new InvoiceValidationError();
  }
  return `INV-${normalized}`;
}
