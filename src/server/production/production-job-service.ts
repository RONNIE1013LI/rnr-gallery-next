import { createHash, randomBytes } from "node:crypto";
import type { MarketCurrency } from "@/domain/markets/types";
import { buildInvoiceNumber, calculateInvoiceTotals, parseInvoiceDraft, type InvoiceDraft } from "@/server/invoices/invoice-domain";
import type {
  OrderFulfilmentStatus,
  OrderPaymentStatus,
  ProductionJobSource,
} from "@/server/db/schema";
import { z } from "zod";

export type ProductionJobSort = "created" | "updated" | "needed";
export type ProductionJobFilters = Readonly<{
  query: string;
  source?: ProductionJobSource;
  status?: OrderFulfilmentStatus;
  paymentStatus?: OrderPaymentStatus;
  urgent?: boolean;
  assignedUserId?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
  sort: ProductionJobSort;
  direction: "asc" | "desc";
}>;

export type ProductionJobIdentity = Readonly<{
  id: string;
  jobNumber: string;
  requestDigest: string;
  updatedAt: Date;
}>;

const fulfilmentStatuses = [
  "new",
  "designing",
  "awaiting_customer",
  "ready_to_print",
  "printing",
  "on_hold",
  "shipped",
  "completed",
  "cancelled",
] as const;
const paymentStatuses = [
  "awaiting_payment",
  "processing",
  "paid",
  "failed",
  "cancelled",
  "refunded",
] as const;
const customerSources = [
  "web",
  "phone",
  "messenger",
  "email",
  "whatsapp",
  "instagram",
  "tiktok",
  "market",
  "walk_in",
  "rnr",
  "wechat",
  "other",
] as const;
const deliveryMethods = [
  "post",
  "pickup",
  "delivery",
  "email",
  "courier",
  "australia_shipping",
  "other",
] as const;
const paymentReconciliationStatuses = [
  "Not checked",
  "Arrive",
  "Afterpay",
  "Stripe",
  "Wise",
  "waitting..",
  "Checked1",
  "Checked2",
  "Checked3",
  "Checked4",
  "Checked5",
  "Checked6",
  "Other",
] as const;

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function scalar(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function validCalendarDate(value: string) {
  if (!isoDatePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

export function parseProductionJobFilters(
  input: Readonly<Record<string, string | string[] | undefined>>,
): ProductionJobFilters {
  const query = (scalar(input.q) ?? "").trim().slice(0, 120);
  const source = scalar(input.source);
  const status = scalar(input.status);
  const paymentStatus = scalar(input.payment);
  const urgent = scalar(input.urgent);
  const assignedUserId = (scalar(input.assigned) ?? "").trim().slice(0, 255);
  const from = scalar(input.from);
  const to = scalar(input.to);
  const sort = scalar(input.sort);
  const direction = scalar(input.direction);
  return Object.freeze({
    query,
    ...(source === "web" || source === "manual" ? { source } : {}),
    ...(fulfilmentStatuses.includes(status as OrderFulfilmentStatus)
      ? { status: status as OrderFulfilmentStatus }
      : {}),
    ...(paymentStatuses.includes(paymentStatus as OrderPaymentStatus)
      ? { paymentStatus: paymentStatus as OrderPaymentStatus }
      : {}),
    ...(urgent === "yes" ? { urgent: true } : urgent === "no" ? { urgent: false } : {}),
    ...(assignedUserId ? { assignedUserId } : {}),
    ...(from && validCalendarDate(from) ? { from } : {}),
    ...(to && validCalendarDate(to) ? { to } : {}),
    page: positiveInteger(scalar(input.page), 1),
    pageSize: Math.min(100, positiveInteger(scalar(input.pageSize), 25)),
    sort: sort === "updated" || sort === "needed" ? sort : "created",
    direction: direction === "asc" ? "asc" : "desc",
  });
}

export function deriveManualJobFinance(input: Readonly<{
  amountPayableCents: number;
  amountPaidCents: number;
  artistFeeCents: number;
  materialCostCents: number;
}>) {
  return Object.freeze({
    amountOwingCents: input.amountPayableCents - input.amountPaidCents,
    actualProfitCents:
      input.amountPaidCents - input.artistFeeCents - input.materialCostCents,
  });
}

const actorSchema = z.object({
  userId: z.string().trim().min(1).max(255),
  email: z.string().trim().toLowerCase().email().max(320),
}).strict();

const itemSchema = z.object({
  productTitle: z.string().trim().min(1).max(190),
  sizeLabel: z.string().trim().min(1).max(190),
  quantity: z.number().int().min(1).max(100),
  designText: z.string().trim().max(5_000).default(""),
  notes: z.string().trim().max(5_000).default(""),
}).strict();

const customFieldValueSchema = z.object({
  fieldId: z.string().uuid(),
  value: z.string().trim().max(10_000),
}).strict();

const manualJobSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(255),
  customerName: z.string().trim().min(1).max(190),
  customerEmail: z.string().trim().toLowerCase().max(320).refine(
    (value) => value === "" || z.string().email().safeParse(value).success,
  ),
  customerPhone: z.string().trim().max(80),
  customerSource: z.enum(customerSources).exclude(["web"]),
  webOrderNumber: z.string().trim().max(190).default(""),
  urgent: z.boolean(),
  neededDate: z.string().refine(validCalendarDate),
  deliveryMethod: z.enum(deliveryMethods),
  deliveryAddress: z.string().trim().max(5_000).default(""),
  paymentReconciliationStatus: z.enum(paymentReconciliationStatuses).default("Not checked"),
  assignedUserId: z.string().trim().min(1).max(255).nullable(),
  designRequirements: z.string().trim().max(10_000),
  internalNotes: z.string().trim().max(10_000),
  manualStatus: z.enum(fulfilmentStatuses),
  manualPaymentStatus: z.enum(paymentStatuses),
  amountPayableCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  amountPaidCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  artistFeeCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  materialCostCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  artistPaid: z.boolean().default(false),
  fileSent: z.boolean().default(false),
  downloaded: z.boolean().default(false),
  printed: z.boolean().default(false),
  customerNotified: z.boolean().default(false),
  delivered: z.boolean().default(false),
  completed: z.boolean().default(false),
  invoiceDraft: z.unknown().optional(),
  customFields: z.array(customFieldValueSchema).max(100).default([]).superRefine((values, context) => {
    if (new Set(values.map((value) => value.fieldId)).size !== values.length) {
      context.addIssue({ code: "custom", message: "Custom fields must be unique" });
    }
  }),
  items: z.array(itemSchema).min(1).max(20),
}).strict().superRefine((input, context) => {
  if (!input.customerEmail && !input.customerPhone) {
    context.addIssue({
      code: "custom",
      path: ["customerEmail"],
      message: "Email or phone is required",
    });
  }
  if (input.amountPaidCents > input.amountPayableCents) {
    context.addIssue({
      code: "custom",
      path: ["amountPaidCents"],
      message: "Paid amount cannot exceed payable amount",
    });
  }
});

type AdminActor = z.output<typeof actorSchema>;
type ManualJob = z.output<typeof manualJobSchema>;

const financeUpdateSchema = z.object({
  manualPaymentStatus: z.enum(paymentStatuses),
  amountPayableCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  amountPaidCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  artistFeeCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  materialCostCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict().superRefine((input, context) => {
  if (input.amountPaidCents > input.amountPayableCents) {
    context.addIssue({
      code: "custom",
      path: ["amountPaidCents"],
      message: "Paid amount cannot exceed payable amount",
    });
  }
});

const milestoneSchema = z.object({
  fileSent: z.boolean().optional(),
  downloaded: z.boolean().optional(),
  printed: z.boolean().optional(),
  customerNotified: z.boolean().optional(),
  delivered: z.boolean().optional(),
  artistPaid: z.boolean().optional(),
  completed: z.boolean().optional(),
}).strict();

const jobUpdateSchema = z.object({
  jobId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(8).max(255),
  expectedUpdatedAt: z.string().datetime(),
  customerName: z.string().trim().min(1).max(190).optional(),
  customerEmail: z.string().trim().toLowerCase().max(320).refine(
    (value) => value === "" || z.string().email().safeParse(value).success,
  ).optional(),
  customerPhone: z.string().trim().max(80).optional(),
  assignedUserId: z.string().trim().min(1).max(255).nullable().optional(),
  urgent: z.boolean().optional(),
  customerSource: z.enum(customerSources).optional(),
  neededDate: z.string().refine(validCalendarDate).optional(),
  deliveryMethod: z.enum(deliveryMethods).optional(),
  deliveryAddress: z.string().trim().max(5_000).optional(),
  paymentReconciliationStatus: z.enum(paymentReconciliationStatuses).optional(),
  designRequirements: z.string().trim().max(10_000).optional(),
  internalNotes: z.string().trim().max(10_000).optional(),
  manualStatus: z.enum(fulfilmentStatuses).optional(),
  milestones: milestoneSchema.optional(),
  finance: financeUpdateSchema.optional(),
  customFields: z.array(customFieldValueSchema).max(100).optional().superRefine((values, context) => {
    if (values && new Set(values.map((value) => value.fieldId)).size !== values.length) {
      context.addIssue({ code: "custom", message: "Custom fields must be unique" });
    }
  }),
  items: z.array(itemSchema).min(1).max(20).optional(),
}).strict().superRefine((input, context) => {
  const mutableKeys = Object.keys(input).filter((key) => ![
    "jobId",
    "idempotencyKey",
    "expectedUpdatedAt",
  ].includes(key));
  if (mutableKeys.length === 0) {
    context.addIssue({ code: "custom", message: "No production fields were provided" });
  }
  if (input.milestones && Object.keys(input.milestones).length === 0) {
    context.addIssue({ code: "custom", path: ["milestones"], message: "No milestone was provided" });
  }
  if (input.customerEmail !== undefined && input.customerPhone !== undefined &&
    !input.customerEmail && !input.customerPhone) {
    context.addIssue({
      code: "custom",
      path: ["customerEmail"],
      message: "At least an email address or phone number is required",
    });
  }
});

type JobUpdate = z.output<typeof jobUpdateSchema>;

export type CreateManualProductionJob = Readonly<Omit<ManualJob, "items" | "artistPaid" | "fileSent" | "downloaded" | "printed" | "customerNotified" | "delivered" | "completed" | "invoiceDraft"> & {
  requestDigest: string;
  jobNumber: string;
  actor: AdminActor;
  createdAt: Date;
  canUpdateFinance: boolean;
  artistPaidAt: Date | null;
  fileSentAt: Date | null;
  downloadedAt: Date | null;
  printedAt: Date | null;
  customerNotifiedAt: Date | null;
  deliveredAt: Date | null;
  completedAt: Date | null;
  items: readonly Readonly<z.output<typeof itemSchema> & { position: number }>[];
  invoice: Readonly<InvoiceDraft & ReturnType<typeof calculateInvoiceTotals> & {
    invoiceNumber: string;
    currency: MarketCurrency;
    gstRateBasisPoints: number;
  }> | null;
}>;

export type UpdateProductionJob = Readonly<
  Omit<JobUpdate, "expectedUpdatedAt" | "milestones" | "finance"> & {
    expectedUpdatedAt: Date;
    actor: AdminActor;
    updatedAt: Date;
    canUpdateFinance: boolean;
    fileSentAt?: Date | null;
    downloadedAt?: Date | null;
    printedAt?: Date | null;
    customerNotifiedAt?: Date | null;
    deliveredAt?: Date | null;
    artistPaidAt?: Date | null;
    completedAt?: Date | null;
    finance?: z.output<typeof financeUpdateSchema>;
  }
>;

export interface ProductionJobRepository {
  findManualByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<ProductionJobIdentity | null>;
  createManual(input: CreateManualProductionJob): Promise<ProductionJobIdentity>;
  update(
    input: UpdateProductionJob,
  ): Promise<"updated" | "duplicate" | "conflict" | "not_found" | "invalid_source">;
  deleteManual(input: Readonly<{
    actor: Readonly<{ userId: string; email: string }>;
    jobId: string;
    expectedJobNumber: string;
    idempotencyKey: string;
  }>): Promise<Readonly<{
    result: "deleted";
    jobNumber: string;
    files: readonly Readonly<{ id: string; storageKey: string }>[];
  }>>;
}

export class ProductionJobValidationError extends Error {
  constructor(message = "Production job data is invalid") {
    super(message);
    this.name = "ProductionJobValidationError";
  }
}

export class ProductionJobConflictError extends Error {
  constructor(message = "This manual job request was already used") {
    super(message);
    this.name = "ProductionJobConflictError";
  }
}

export class ProductionJobNotFoundError extends Error {
  constructor() {
    super("Production job not found");
    this.name = "ProductionJobNotFoundError";
  }
}

function digestManualJob(input: ManualJob) {
  const { idempotencyKey, ...payload } = input;
  void idempotencyKey;
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function createManualJobNumber(
  now = new Date(),
  createSuffix: () => string = () => randomBytes(5).toString("hex").toUpperCase(),
) {
  const year = new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
  }).format(now);
  return `RRM-${year}-${createSuffix()}`;
}

export function createProductionJobService(
  repository: ProductionJobRepository,
  dependencies: Readonly<{
    createJobNumber?: () => string | Promise<string>;
    now?: () => Date;
  }> = {},
) {
  return Object.freeze({
    async createManual(
      actorInput: unknown,
      jobInput: unknown,
      permissions: Readonly<{ canUpdateFinance: boolean }>,
    ) {
      const actorResult = actorSchema.safeParse(actorInput);
      const jobResult = manualJobSchema.safeParse(jobInput);
      if (!actorResult.success || !jobResult.success) {
        throw new ProductionJobValidationError();
      }
      const actor = actorResult.data;
      const job = jobResult.data;
      if (!permissions.canUpdateFinance && (
        job.manualPaymentStatus !== "awaiting_payment" ||
        job.amountPayableCents !== 0 ||
        job.amountPaidCents !== 0 ||
        job.artistFeeCents !== 0 ||
        job.materialCostCents !== 0 ||
        job.paymentReconciliationStatus !== "Not checked" ||
        job.artistPaid
      )) {
        throw new ProductionJobValidationError("Finance permission is required");
      }
      if (job.invoiceDraft !== undefined && !permissions.canUpdateFinance) {
        throw new ProductionJobValidationError("Finance permission is required");
      }
      const requestDigest = digestManualJob(job);
      const existing = await repository.findManualByIdempotencyKey(
        job.idempotencyKey,
      );
      if (existing) {
        if (existing.requestDigest !== requestDigest) {
          throw new ProductionJobConflictError();
        }
        return Object.freeze({ result: "duplicate" as const, job: existing });
      }

      const createdAt = dependencies.now?.() ?? new Date();
      const jobNumber = await (dependencies.createJobNumber?.() ?? createManualJobNumber(createdAt));
      let invoice: CreateManualProductionJob["invoice"] = null;
      if (job.invoiceDraft !== undefined) {
        try {
          const parsed = parseInvoiceDraft(job.invoiceDraft);
          invoice = Object.freeze({
            ...parsed,
            reference: parsed.reference === "DRAFT" ? jobNumber : parsed.reference,
            ...calculateInvoiceTotals(parsed, 1_500),
            invoiceNumber: buildInvoiceNumber(jobNumber),
            currency: "NZD" as const,
            gstRateBasisPoints: 1_500,
          });
        } catch {
          throw new ProductionJobValidationError("Invoice data is invalid");
        }
      }
      const {
        artistPaid,
        fileSent,
        downloaded,
        printed,
        customerNotified,
        delivered,
        completed,
        invoiceDraft,
        ...persistedJob
      } = job;
      void invoiceDraft;
      const created = await repository.createManual({
        ...persistedJob,
        requestDigest,
        jobNumber,
        actor,
        createdAt,
        canUpdateFinance: permissions.canUpdateFinance,
        artistPaidAt: artistPaid ? createdAt : null,
        fileSentAt: fileSent ? createdAt : null,
        downloadedAt: downloaded ? createdAt : null,
        printedAt: printed ? createdAt : null,
        customerNotifiedAt: customerNotified ? createdAt : null,
        deliveredAt: delivered ? createdAt : null,
        completedAt: completed ? createdAt : null,
        items: job.items.map((item, position) => Object.freeze({ ...item, position })),
        invoice,
      });
      return Object.freeze({ result: "created" as const, job: created });
    },

    async update(
      actorInput: unknown,
      updateInput: unknown,
      permissions: Readonly<{ canUpdateFinance: boolean }>,
    ) {
      const actorResult = actorSchema.safeParse(actorInput);
      const updateResult = jobUpdateSchema.safeParse(updateInput);
      if (!actorResult.success || !updateResult.success) {
        throw new ProductionJobValidationError();
      }
      const update = updateResult.data;
      if ((
        update.finance ||
        update.paymentReconciliationStatus !== undefined ||
        update.milestones?.artistPaid !== undefined
      ) && !permissions.canUpdateFinance) {
        throw new ProductionJobValidationError("Finance permission is required");
      }
      const updatedAt = dependencies.now?.() ?? new Date();
      const milestoneValues = update.milestones
        ? {
            ...(update.milestones.fileSent !== undefined
              ? { fileSentAt: update.milestones.fileSent ? updatedAt : null }
              : {}),
            ...(update.milestones.downloaded !== undefined
              ? { downloadedAt: update.milestones.downloaded ? updatedAt : null }
              : {}),
            ...(update.milestones.printed !== undefined
              ? { printedAt: update.milestones.printed ? updatedAt : null }
              : {}),
            ...(update.milestones.customerNotified !== undefined
              ? { customerNotifiedAt: update.milestones.customerNotified ? updatedAt : null }
              : {}),
            ...(update.milestones.delivered !== undefined
              ? { deliveredAt: update.milestones.delivered ? updatedAt : null }
              : {}),
            ...(update.milestones.artistPaid !== undefined
              ? { artistPaidAt: update.milestones.artistPaid ? updatedAt : null }
              : {}),
            ...(update.milestones.completed !== undefined
              ? { completedAt: update.milestones.completed ? updatedAt : null }
              : {}),
          }
        : {};
      const {
        expectedUpdatedAt,
        milestones,
        ...fields
      } = update;
      void milestones;
      const result = await repository.update({
        ...fields,
        ...milestoneValues,
        expectedUpdatedAt: new Date(expectedUpdatedAt),
        actor: actorResult.data,
        updatedAt,
        canUpdateFinance: permissions.canUpdateFinance,
      });
      if (result === "conflict") throw new ProductionJobConflictError("The job changed before this update was saved");
      if (result === "not_found") throw new ProductionJobNotFoundError();
      if (result === "invalid_source") throw new ProductionJobValidationError("Linked web order status must be updated from the order workflow");
      return result;
    },
  });
}
