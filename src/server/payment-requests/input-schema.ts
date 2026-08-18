import { z } from "zod";

const amountCentsSchema = z.number().int().safe().positive().max(100_000_000);
const currencySchema = z.enum(["NZD", "AUD"]);
const methodSchema = z.enum(["card", "afterpay", "zip"]);
const idempotencyKeySchema = z.string().trim().min(8).max(255);
const optionalText = (maximum: number) =>
  z.string().trim().max(maximum).transform((value) => value || undefined).optional();

const enabledPaymentMethodsSchema = z.array(methodSchema).min(1).max(3)
  .refine((methods) => new Set(methods).size === methods.length, {
    message: "Payment methods must be unique",
  });

const requestFields = {
  amountCents: amountCentsSchema,
  currency: currencySchema,
  description: z.string().trim().min(1).max(500),
  enabledPaymentMethods: enabledPaymentMethodsSchema,
  expiresAt: z.string().datetime().optional(),
  internalNote: optionalText(2_000),
};

export const createPaymentRequestInputSchema = z.discriminatedUnion("kind", [
  z.object({
    ...requestFields,
    kind: z.literal("order_balance"),
    orderId: z.string().uuid(),
  }).strict(),
  z.object({
    ...requestFields,
    kind: z.literal("standalone"),
    customerName: optionalText(120),
    customerEmail: z.string().trim().toLowerCase().email().max(320).optional(),
  }).strict(),
]);

export const recordBankTransferInputSchema = z.object({
  orderId: z.string().uuid(),
  amountCents: amountCentsSchema,
  receivedAt: z.string().datetime(),
  reference: optionalText(200),
  payerName: optionalText(120),
  note: optionalText(2_000),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const reverseLedgerEntryInputSchema = z.object({
  entryId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: idempotencyKeySchema,
}).strict();

const payerBase = {
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  idempotencyKey: idempotencyKeySchema,
};

const addressFields = {
  building: z.string().trim().max(100),
  street: z.string().trim().min(1).max(180),
  suburb: z.string().trim().min(1).max(100),
  region: z.string().trim().min(1).max(100),
  postcode: z.string().trim().regex(/^\d{4}$/),
};

export const standalonePayerInputSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("card"),
    ...payerBase,
    phone: optionalText(32),
  }).strict(),
  z.object({
    method: z.literal("afterpay"),
    ...payerBase,
    phone: z.string().trim().min(1).max(32),
    address: z.object({
      country: z.enum(["NZ", "AU"]),
      ...addressFields,
    }).strict(),
  }).strict(),
  z.object({
    method: z.literal("zip"),
    ...payerBase,
    phone: z.string().trim().min(1).max(32),
    address: z.object({
      country: z.literal("AU"),
      ...addressFields,
    }).strict(),
  }).strict(),
]);

export type CreatePaymentRequestInput = z.output<typeof createPaymentRequestInputSchema>;
export type RecordBankTransferInput = z.output<typeof recordBankTransferInputSchema>;
export type ReverseLedgerEntryInput = z.output<typeof reverseLedgerEntryInputSchema>;
export type StandalonePayerInput = z.output<typeof standalonePayerInputSchema>;
