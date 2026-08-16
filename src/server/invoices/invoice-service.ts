import { z } from "zod";
import type { MarketCurrency } from "@/domain/markets/types";
import {
  buildInvoiceNumber,
  calculateInvoiceTotals,
  parseInvoiceDraft,
  type InvoiceDraft,
} from "./invoice-domain";

export type InvoiceItemRecord = Readonly<{
  position: number;
  code: string;
  description: string;
  quantityMilli: number;
  rateInclGstCents: number;
  lineTotalInclGstCents: number;
}>;

export type InvoiceRecord = Readonly<{
  id: string;
  jobId: string;
  invoiceNumber: string;
  status: "draft" | "issued" | "void";
  invoiceDate: string;
  dueDate: string;
  reference: string;
  webOrderNumber: string;
  businessName: string;
  businessAddress: string;
  businessEmail: string;
  businessPhone: string;
  businessWebsite: string;
  gstNumber: string;
  bankAccount: string;
  customerName: string;
  customerEmail: string;
  customerAddress: string;
  deliveryAddress: string;
  currency: MarketCurrency;
  gstRateBasisPoints: number;
  pricesIncludeGst: true;
  grossCents: number;
  discountCents: number;
  subtotalExGstCents: number;
  gstCents: number;
  totalInclGstCents: number;
  notes: string;
  terms: string;
  issuedAt: Date | null;
  voidedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: readonly InvoiceItemRecord[];
}>;

export type InvoiceSeed = Readonly<{
  jobNumber: string;
  webOrderNumber: string;
  customerName: string;
  customerEmail: string;
  customerAddress: string;
  deliveryAddress: string;
  currency?: MarketCurrency;
  gstRateBasisPoints?: number;
  items: readonly Readonly<{
    code: string;
    description: string;
    quantityMilli: number;
    rateInclGstCents: number;
  }>[];
  totals?: Readonly<ReturnType<typeof calculateInvoiceTotals>>;
}>;

type Actor = Readonly<{ userId: string; email: string }>;
type Business = Readonly<{
  name: string;
  address: string;
  email: string;
  phone: string;
  website: string;
  gstNumber: string;
  bankAccount: string;
}>;
type InvoiceMutationResult = Readonly<{
  result: "updated" | "issued" | "voided" | "duplicate" | "conflict" | "not_found" | "immutable";
  invoice: InvoiceRecord | null;
}>;

export type CreateInvoiceDraft = Readonly<{
  jobId: string;
  invoiceNumber: string;
  webOrderNumber: string;
  businessName: string;
  businessAddress: string;
  businessEmail: string;
  businessPhone: string;
  businessWebsite: string;
  gstNumber: string;
  bankAccount: string;
  currency: MarketCurrency;
  gstRateBasisPoints: number;
  pricesIncludeGst: true;
  actor: Actor;
  createdAt: Date;
} & InvoiceDraft & ReturnType<typeof calculateInvoiceTotals>>;

export type UpdateInvoiceDraft = Readonly<{
  invoiceId: string;
  idempotencyKey: string;
  expectedUpdatedAt: Date;
  actor: Actor;
  updatedAt: Date;
} & InvoiceDraft & ReturnType<typeof calculateInvoiceTotals>>;

export interface InvoiceRepository {
  findByJobId(jobId: string): Promise<InvoiceRecord | null>;
  findById(invoiceId: string): Promise<InvoiceRecord | null>;
  getSeed(jobId: string): Promise<InvoiceSeed | null>;
  createDraft(input: CreateInvoiceDraft): Promise<InvoiceRecord>;
  updateDraft(input: UpdateInvoiceDraft): Promise<InvoiceMutationResult>;
  issue(input: Readonly<{
    invoiceId: string;
    idempotencyKey: string;
    expectedUpdatedAt: Date;
    actor: Actor;
    issuedAt: Date;
  }>): Promise<InvoiceMutationResult>;
  void(input: Readonly<{
    invoiceId: string;
    idempotencyKey: string;
    expectedUpdatedAt: Date;
    reason: string;
    actor: Actor;
    voidedAt: Date;
  }>): Promise<InvoiceMutationResult>;
}

export class InvoiceNotFoundError extends Error {
  constructor() {
    super("Invoice or production job not found");
    this.name = "InvoiceNotFoundError";
  }
}

export class InvoiceConflictError extends Error {
  constructor() {
    super("The invoice changed before this action was saved");
    this.name = "InvoiceConflictError";
  }
}

export class InvoiceImmutableError extends Error {
  constructor() {
    super("Issued or void invoices cannot be edited");
    this.name = "InvoiceImmutableError";
  }
}

export class InvoiceRequestValidationError extends Error {
  constructor() {
    super("Invoice request is invalid");
    this.name = "InvoiceRequestValidationError";
  }
}

const actorSchema = z.object({
  userId: z.string().trim().min(1).max(255),
  email: z.string().trim().toLowerCase().email().max(320),
}).strict();
const mutationSchema = z.object({
  invoiceId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(8).max(255),
  expectedUpdatedAt: z.string().datetime(),
}).strict();
const voidSchema = mutationSchema.extend({
  reason: z.string().trim().min(3).max(1_000),
}).strict();

function aucklandDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function addCalendarDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function parseActor(input: unknown) {
  const parsed = actorSchema.safeParse(input);
  if (!parsed.success) throw new InvoiceRequestValidationError();
  return parsed.data;
}

function unwrap(result: InvoiceMutationResult) {
  if ((result.result === "updated" || result.result === "issued" || result.result === "voided" || result.result === "duplicate") && result.invoice) {
    return result.invoice;
  }
  if (result.result === "conflict") throw new InvoiceConflictError();
  if (result.result === "immutable") throw new InvoiceImmutableError();
  throw new InvoiceNotFoundError();
}

function totalsFromSeed(seed: InvoiceSeed, draft: InvoiceDraft) {
  if (!seed.totals) return calculateInvoiceTotals(draft, seed.gstRateBasisPoints ?? 1_500);
  const grossCents = draft.items.reduce(
    (sum, item) => sum + Math.round(item.quantityMilli * item.rateInclGstCents / 1_000),
    0,
  );
  const totals = seed.totals;
  if (
    totals.grossCents !== grossCents ||
    totals.discountCents !== draft.discountCents ||
    totals.totalInclGstCents !== totals.grossCents - totals.discountCents ||
    totals.totalInclGstCents !== totals.subtotalExGstCents + totals.gstCents ||
    Object.values(totals).some((value) => !Number.isSafeInteger(value) || value < 0)
  ) {
    throw new InvoiceRequestValidationError();
  }
  return totals;
}

function totalsForUpdate(existing: InvoiceRecord, draft: InvoiceDraft) {
  const financialsUnchanged = existing.discountCents === draft.discountCents &&
    existing.items.length === draft.items.length &&
    existing.items.every((item, index) =>
      item.quantityMilli === draft.items[index]?.quantityMilli &&
      item.rateInclGstCents === draft.items[index]?.rateInclGstCents,
    );
  if (!financialsUnchanged) return calculateInvoiceTotals(draft, existing.gstRateBasisPoints);
  return Object.freeze({
    grossCents: existing.grossCents,
    discountCents: existing.discountCents,
    subtotalExGstCents: existing.subtotalExGstCents,
    gstCents: existing.gstCents,
    totalInclGstCents: existing.totalInclGstCents,
  });
}

export function createInvoiceService(
  repository: InvoiceRepository,
  dependencies: Readonly<{ business: Business; now?: () => Date }>,
) {
  return Object.freeze({
    async getOrCreateDraft(actorInput: unknown, jobIdInput: unknown) {
      const actor = parseActor(actorInput);
      const jobId = z.string().uuid().safeParse(jobIdInput);
      if (!jobId.success) throw new InvoiceRequestValidationError();
      const existing = await repository.findByJobId(jobId.data);
      if (existing) return existing;
      const seed = await repository.getSeed(jobId.data);
      if (!seed) throw new InvoiceNotFoundError();
      const createdAt = dependencies.now?.() ?? new Date();
      const invoiceDate = aucklandDate(createdAt);
      const draft = parseInvoiceDraft({
        invoiceDate,
        dueDate: addCalendarDays(invoiceDate, 7),
        reference: seed.jobNumber,
        customerName: seed.customerName,
        customerEmail: seed.customerEmail,
        customerAddress: seed.customerAddress,
        deliveryAddress: seed.deliveryAddress,
        discountCents: 0,
        notes: "Thank you for your business!",
        terms: "Payment is due within 7 days.",
        items: seed.items,
      });
      const totals = totalsFromSeed(seed, draft);
      return repository.createDraft({
        ...draft,
        ...totals,
        jobId: jobId.data,
        invoiceNumber: buildInvoiceNumber(seed.jobNumber),
        webOrderNumber: seed.webOrderNumber,
        businessName: dependencies.business.name,
        businessAddress: dependencies.business.address,
        businessEmail: dependencies.business.email,
        businessPhone: dependencies.business.phone,
        businessWebsite: dependencies.business.website,
        gstNumber: dependencies.business.gstNumber,
        bankAccount: dependencies.business.bankAccount,
        currency: seed.currency ?? "NZD",
        gstRateBasisPoints: seed.gstRateBasisPoints ?? 1_500,
        pricesIncludeGst: true,
        actor,
        createdAt,
      });
    },

    async updateDraft(actorInput: unknown, input: unknown) {
      const actor = parseActor(actorInput);
      const envelope = z.object({
        invoiceId: z.string().uuid(),
        idempotencyKey: z.string().trim().min(8).max(255),
        expectedUpdatedAt: z.string().datetime(),
        draft: z.unknown(),
      }).strict().safeParse(input);
      if (!envelope.success) throw new InvoiceRequestValidationError();
      const existing = await repository.findById(envelope.data.invoiceId);
      if (!existing) throw new InvoiceNotFoundError();
      const suppliedDraft = envelope.data.draft && typeof envelope.data.draft === "object"
        ? envelope.data.draft as Record<string, unknown>
        : {};
      const draft = parseInvoiceDraft({
        businessName: existing.businessName,
        businessAddress: existing.businessAddress,
        businessEmail: existing.businessEmail,
        businessPhone: existing.businessPhone,
        businessWebsite: existing.businessWebsite,
        gstNumber: existing.gstNumber,
        bankAccount: existing.bankAccount,
        ...suppliedDraft,
      });
      const totals = totalsForUpdate(existing, draft);
      return unwrap(await repository.updateDraft({
        ...draft,
        ...totals,
        invoiceId: envelope.data.invoiceId,
        idempotencyKey: envelope.data.idempotencyKey,
        expectedUpdatedAt: new Date(envelope.data.expectedUpdatedAt),
        actor,
        updatedAt: dependencies.now?.() ?? new Date(),
      }));
    },

    async issue(actorInput: unknown, input: unknown) {
      const actor = parseActor(actorInput);
      const parsed = mutationSchema.safeParse(input);
      if (!parsed.success) throw new InvoiceRequestValidationError();
      return unwrap(await repository.issue({
        ...parsed.data,
        expectedUpdatedAt: new Date(parsed.data.expectedUpdatedAt),
        actor,
        issuedAt: dependencies.now?.() ?? new Date(),
      }));
    },

    async void(actorInput: unknown, input: unknown) {
      const actor = parseActor(actorInput);
      const parsed = voidSchema.safeParse(input);
      if (!parsed.success) throw new InvoiceRequestValidationError();
      return unwrap(await repository.void({
        ...parsed.data,
        expectedUpdatedAt: new Date(parsed.data.expectedUpdatedAt),
        actor,
        voidedAt: dependencies.now?.() ?? new Date(),
      }));
    },

    async getDocument(invoiceIdInput: unknown) {
      const invoiceId = z.string().uuid().safeParse(invoiceIdInput);
      if (!invoiceId.success) throw new InvoiceRequestValidationError();
      const invoice = await repository.findById(invoiceId.data);
      if (!invoice) throw new InvoiceNotFoundError();
      return invoice;
    },
  });
}
