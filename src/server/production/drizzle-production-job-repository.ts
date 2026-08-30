import { createHash } from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  ilike,
  inArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import {
  MANUAL_ATTRIBUTION_FIELD_KEYS,
} from "@/domain/analytics/manual-order-attribution";
import {
  buildConversionDeliveryCandidates,
  parseConversionActivationPolicy,
  type ConversionActivationPolicy,
} from "@/domain/analytics/conversion-delivery-candidate";
import {
  enqueueConversionDeliveries,
  type ConversionDeliveryTransaction,
} from "@/server/analytics/drizzle-conversion-delivery-repository";
import {
  createWebsiteAnalyticsV2BusinessRecorder,
  type WebsiteAnalyticsV2BusinessRecorder,
} from "@/server/analytics/website-analytics-v2-business-recorder";
import {
  adminAuditLogs,
  invoiceItems,
  invoices,
  orders,
  paymentRequests,
  productionJobItems,
  productionJobFiles,
  productionJobs,
  productionFieldDefinitions,
  productionFieldValues,
  user,
  type OrderFulfilmentStatus,
  type OrderPaymentStatus,
} from "@/server/db/schema";
import { buildAuditRecord } from "@/server/admin/audit-service";
import { enqueueInternalNotifications } from "@/server/notifications/drizzle-internal-notification-outbox-repository";
import {
  ProductionJobConflictError,
  ProductionJobNotFoundError,
  ProductionJobValidationError,
  deriveManualJobFinance,
  type ProductionJobFilters,
  type ProductionJobRepository,
} from "./production-job-service";
import { projectWebOrderFinance } from "./production-job-finance";
import { productionJobAuditChanges, type ProductionJobAuditChange } from "./production-job-audit";

type Database = ReturnType<typeof getDatabase>;

export type ManualConversionEvidenceInput = Readonly<{
  jobId: string;
  actor: Readonly<{ userId: string; email: string }>;
  consentDecision: "granted" | "denied";
  consentRecordedAt: Date;
  source: "google" | "meta";
  attribution?: Readonly<Partial<Record<
    "gclid" | "gbraid" | "wbraid" | "fbclid" | "fbp" | "fbc",
    string
  >>>;
}>;

const conversionClickIdPattern = /^[A-Za-z0-9._~-]{1,200}$/;
const conversionMetaCookiePattern = /^fb\.1\.\d{10,13}\.[A-Za-z0-9._-]{1,200}$/;

function manualConversionEvidenceValues(input: ManualConversionEvidenceInput) {
  if (!(input.consentRecordedAt instanceof Date)
    || Number.isNaN(input.consentRecordedAt.getTime())) {
    throw new ProductionJobValidationError("Advertising consent timestamp is invalid");
  }
  const attribution = Object.fromEntries(Object.entries(input.attribution ?? {}).map(
    ([key, value]) => [key, value.trim()],
  )) as Record<string, string>;
  if (input.consentDecision === "denied" && Object.values(attribution).some(Boolean)) {
    throw new ProductionJobValidationError("Denied consent cannot store advertising identifiers");
  }
  const googleIds = [attribution.gclid, attribution.gbraid, attribution.wbraid].filter(Boolean);
  if (googleIds.length > 1
    || googleIds.some((value) => !conversionClickIdPattern.test(value))) {
    throw new ProductionJobValidationError("Google attribution is invalid");
  }
  if (attribution.fbclid && !conversionClickIdPattern.test(attribution.fbclid)) {
    throw new ProductionJobValidationError("Meta attribution is invalid");
  }
  if ([attribution.fbp, attribution.fbc].some(
    (value) => value && !conversionMetaCookiePattern.test(value),
  )) {
    throw new ProductionJobValidationError("Meta attribution is invalid");
  }
  if (input.source === "google"
    && [attribution.fbclid, attribution.fbp, attribution.fbc].some(Boolean)) {
    throw new ProductionJobValidationError("Attribution source is inconsistent");
  }
  if (input.source === "meta" && googleIds.length) {
    throw new ProductionJobValidationError("Attribution source is inconsistent");
  }
  return Object.freeze({
    advertising_consent: input.consentDecision,
    advertising_consent_recorded_at: input.consentRecordedAt.toISOString(),
    advertising_source: input.source,
    gclid: attribution.gclid ?? "",
    gbraid: attribution.gbraid ?? "",
    wbraid: attribution.wbraid ?? "",
    fbclid: attribution.fbclid ?? "",
    fbp: attribution.fbp ?? "",
    fbc: attribution.fbc ?? "",
  });
}

async function writeManualConversionEvidence(
  transaction: ConversionDeliveryTransaction,
  input: ManualConversionEvidenceInput,
) {
  const values = manualConversionEvidenceValues(input);
  const definitions = await transaction.select({
    id: productionFieldDefinitions.id,
    fieldKey: productionFieldDefinitions.fieldKey,
  }).from(productionFieldDefinitions).where(inArray(
    productionFieldDefinitions.fieldKey,
    MANUAL_ATTRIBUTION_FIELD_KEYS,
  ));
  if (definitions.length !== MANUAL_ATTRIBUTION_FIELD_KEYS.length) {
    throw new Error("Manual conversion evidence schema is incomplete");
  }
  await transaction.insert(productionFieldValues).values(definitions.map((definition) => ({
    jobId: input.jobId,
    fieldId: definition.id,
    value: values[definition.fieldKey as keyof typeof values],
    updatedByUserId: input.actor.userId,
    createdAt: input.consentRecordedAt,
    updatedAt: input.consentRecordedAt,
  }))).onConflictDoUpdate({
    target: [productionFieldValues.jobId, productionFieldValues.fieldId],
    set: {
      value: sql`excluded.value`,
      updatedByUserId: input.actor.userId,
      updatedAt: input.consentRecordedAt,
    },
  });
  const evidenceDigest = createHash("sha256")
    .update(JSON.stringify(values))
    .digest("hex");
  await transaction.insert(adminAuditLogs).values(buildAuditRecord({
    actorUserId: input.actor.userId,
    actorEmail: input.actor.email,
    action: "production_job.conversion_evidence_recorded",
    resourceType: "production_job",
    resourceId: input.jobId,
    afterSummary: {
      consentDecision: input.consentDecision,
      consentRecordedAt: input.consentRecordedAt.toISOString(),
      source: input.source,
      identifierKinds: Object.keys(input.attribution ?? {}).filter(
        (key) => Boolean(input.attribution?.[key as keyof NonNullable<typeof input.attribution>]),
      ),
    },
    requestSource: "admin.jobs.conversion_evidence",
    result: "success",
    idempotencyKey: `conversion-evidence:${input.jobId}:${evidenceDigest}`,
  })).onConflictDoNothing();
}

export async function recordManualConversionEvidence(
  database: Database,
  input: ManualConversionEvidenceInput,
): Promise<"not_found" | "invalid_source" | "already_finalized"> {
  manualConversionEvidenceValues(input);
  return database.transaction(async (transaction) => {
    const [job] = await transaction.select({
      id: productionJobs.id,
      source: productionJobs.source,
    }).from(productionJobs)
      .where(eq(productionJobs.id, input.jobId))
      .for("update")
      .limit(1);
    if (!job) return "not_found" as const;
    if (job.source !== "manual") return "invalid_source" as const;
    return "already_finalized" as const;
  });
}

async function enqueueAuthoritativeManualOrderFinalization(
  transaction: ConversionDeliveryTransaction,
  input: Readonly<{
    jobId: string;
    finalizedAt: Date;
    customerSource: string;
    customerEmail: string;
    customerPhone: string;
    webOrderNumber: string;
    valueMinor: number;
    currency: string;
    conversionEvidence: ManualConversionEvidenceInput;
  }>,
  policy: ConversionActivationPolicy,
  enqueue: typeof enqueueConversionDeliveries,
) {
  let linkedOnlineOrder = false;
  if (input.webOrderNumber) {
    const [linkedOrder] = await transaction.select({ id: orders.id })
      .from(orders)
      .where(eq(orders.orderNumber, input.webOrderNumber))
      .limit(1);
    const [linkedPaymentRequest] = await transaction.select({ id: paymentRequests.id })
      .from(paymentRequests)
      .where(eq(paymentRequests.requestNumber, input.webOrderNumber))
      .limit(1);
    linkedOnlineOrder = Boolean(linkedOrder || linkedPaymentRequest);
  }
  const fields = manualConversionEvidenceValues(input.conversionEvidence);
  const candidates = buildConversionDeliveryCandidates({
    jobId: input.jobId,
    source: "manual",
    finalizedAt: input.finalizedAt,
    customerSource: input.customerSource,
    customerEmail: input.customerEmail,
    customerPhone: input.customerPhone,
    valueMinor: input.valueMinor,
    currency: input.currency,
    linkedOnlineOrder,
    customFields: fields,
  }, policy);
  return enqueue(transaction, candidates);
}

export type ProductionAssignee = Readonly<{
  id: string;
  name: string;
  email: string;
  role: "admin" | "staff" | "form_staff";
}>;

export async function listProductionAssignees(
  database: Database,
): Promise<readonly ProductionAssignee[]> {
  const rows = await database.select({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  }).from(user)
    .where(inArray(user.role, ["admin", "staff", "form_staff"]))
    .orderBy(asc(user.name), asc(user.email));
  return Object.freeze(rows.map((row) => Object.freeze({
    ...row,
    role: row.role as "admin" | "staff" | "form_staff",
  })));
}

type FinanceProjection = Readonly<{
  amountPayableCents: number;
  amountPaidCents: number;
  amountOwingCents: number;
  artistFeeCents: number | null;
  materialCostCents: number | null;
  actualProfitCents: number | null;
}>;

export type ProductionJobListItem = Readonly<{
  id: string;
  jobNumber: string;
  orderId: string | null;
  orderNumber: string | null;
  source: "web" | "manual";
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerSource: typeof productionJobs.$inferSelect.customerSource;
  urgent: boolean;
  neededDate: string;
  deliveryMethod: typeof productionJobs.$inferSelect.deliveryMethod;
  assignedUserId: string | null;
  assignedUserName: string | null;
  status: OrderFulfilmentStatus;
  paymentStatus: OrderPaymentStatus;
  productTitles: readonly string[];
  sizeLabels: readonly string[];
  finance: FinanceProjection | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type ProductionJobListResult = Readonly<{
  items: readonly ProductionJobListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}>;

function listConditions(filters: ProductionJobFilters): SQL[] {
  const conditions: SQL[] = [];
  if (filters.query) {
    const escaped = filters.query.replaceAll("%", "\\%").replaceAll("_", "\\_");
    const pattern = `%${escaped}%`;
    conditions.push(or(
      ilike(productionJobs.jobNumber, pattern),
      ilike(productionJobs.customerName, pattern),
      ilike(productionJobs.customerEmail, pattern),
      ilike(productionJobs.customerPhone, pattern),
    )!);
  }
  if (filters.source) conditions.push(eq(productionJobs.source, filters.source));
  if (filters.status) {
    conditions.push(sql`coalesce(${orders.fulfilmentStatus}, ${productionJobs.manualStatus}) = ${filters.status}`);
  }
  if (filters.paymentStatus) {
    conditions.push(sql`coalesce(${orders.paymentStatus}, ${productionJobs.manualPaymentStatus}) = ${filters.paymentStatus}`);
  }
  if (filters.urgent !== undefined) conditions.push(eq(productionJobs.urgent, filters.urgent));
  if (filters.assignedUserId) conditions.push(eq(productionJobs.assignedUserId, filters.assignedUserId));
  if (filters.from) conditions.push(sql`${productionJobs.neededDate} >= ${filters.from}`);
  if (filters.to) conditions.push(sql`${productionJobs.neededDate} <= ${filters.to}`);
  return conditions;
}

function manualFinance(input: Readonly<{
  amountPayableCents: number;
  amountPaidCents: number;
  artistFeeCents: number;
  materialCostCents: number;
}>): FinanceProjection {
  const derived = deriveManualJobFinance(input);
  return Object.freeze({ ...input, ...derived });
}

export async function listProductionJobs(
  database: Database,
  filters: ProductionJobFilters,
  permissions: Readonly<{ canViewFinance: boolean }>,
): Promise<ProductionJobListResult> {
  const conditions = listConditions(filters);
  const where = conditions.length ? and(...conditions) : undefined;
  const sortColumn = filters.sort === "updated"
    ? productionJobs.updatedAt
    : filters.sort === "needed"
      ? productionJobs.neededDate
      : productionJobs.createdAt;
  const orderBy = filters.direction === "asc" ? asc(sortColumn) : desc(sortColumn);
  const offset = (filters.page - 1) * filters.pageSize;
  const [rows, totals] = await Promise.all([
    database.select({
      id: productionJobs.id,
      jobNumber: productionJobs.jobNumber,
      orderId: productionJobs.orderId,
      orderNumber: orders.orderNumber,
      source: productionJobs.source,
      customerName: productionJobs.customerName,
      customerEmail: productionJobs.customerEmail,
      customerPhone: productionJobs.customerPhone,
      customerSource: productionJobs.customerSource,
      urgent: productionJobs.urgent,
      neededDate: productionJobs.neededDate,
      deliveryMethod: productionJobs.deliveryMethod,
      assignedUserId: productionJobs.assignedUserId,
      manualStatus: productionJobs.manualStatus,
      orderStatus: orders.fulfilmentStatus,
      manualPaymentStatus: productionJobs.manualPaymentStatus,
      orderPaymentStatus: orders.paymentStatus,
      createdAt: productionJobs.createdAt,
      updatedAt: productionJobs.updatedAt,
    }).from(productionJobs)
      .leftJoin(orders, eq(orders.id, productionJobs.orderId))
      .where(where)
      .orderBy(orderBy, desc(productionJobs.jobNumber))
      .limit(filters.pageSize)
      .offset(offset),
    database.select({ total: count() }).from(productionJobs)
      .leftJoin(orders, eq(orders.id, productionJobs.orderId))
      .where(where),
  ]);

  const jobIds = rows.map((row) => row.id);
  const assigneeIds = [...new Set(rows.flatMap((row) => row.assignedUserId ? [row.assignedUserId] : []))];
  const [itemRows, assigneeRows, financeRows] = await Promise.all([
    jobIds.length
      ? database.select().from(productionJobItems)
        .where(inArray(productionJobItems.jobId, jobIds))
        .orderBy(productionJobItems.position)
      : Promise.resolve([]),
    assigneeIds.length
      ? database.select({ id: user.id, name: user.name }).from(user)
        .where(inArray(user.id, assigneeIds))
      : Promise.resolve([]),
    permissions.canViewFinance && jobIds.length
      ? database.select({
          id: productionJobs.id,
          source: productionJobs.source,
          amountPayableCents: productionJobs.amountPayableCents,
          amountPaidCents: productionJobs.amountPaidCents,
          artistFeeCents: productionJobs.artistFeeCents,
          materialCostCents: productionJobs.materialCostCents,
          orderTotalInclGstCents: orders.totalInclGstCents,
          orderPaymentStatus: orders.paymentStatus,
        }).from(productionJobs)
          .leftJoin(orders, eq(orders.id, productionJobs.orderId))
          .where(inArray(productionJobs.id, jobIds))
      : Promise.resolve([]),
  ]);

  const assignees = new Map(assigneeRows.map((row) => [row.id, row.name]));
  const finances = new Map(financeRows.map((row) => {
    if (row.source === "web") {
      return [row.id, projectWebOrderFinance(
        row.orderTotalInclGstCents ?? 0,
        row.orderPaymentStatus ?? "awaiting_payment",
      )] as const;
    }
    return [row.id, manualFinance({
      amountPayableCents: row.amountPayableCents ?? 0,
      amountPaidCents: row.amountPaidCents ?? 0,
      artistFeeCents: row.artistFeeCents ?? 0,
      materialCostCents: row.materialCostCents ?? 0,
    })] as const;
  }));

  const items = rows.map((row) => {
    const jobItems = itemRows.filter((item) => item.jobId === row.id);
    return Object.freeze({
      id: row.id,
      jobNumber: row.jobNumber,
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      source: row.source,
      customerName: row.customerName,
      customerEmail: row.customerEmail,
      customerPhone: row.customerPhone,
      customerSource: row.customerSource,
      urgent: row.urgent,
      neededDate: row.neededDate,
      deliveryMethod: row.deliveryMethod,
      assignedUserId: row.assignedUserId,
      assignedUserName: row.assignedUserId ? assignees.get(row.assignedUserId) ?? null : null,
      status: row.orderStatus ?? row.manualStatus ?? "new",
      paymentStatus: row.orderPaymentStatus ?? row.manualPaymentStatus ?? "awaiting_payment",
      productTitles: Object.freeze([...new Set(jobItems.map((item) => item.productTitle))]),
      sizeLabels: Object.freeze([...new Set(jobItems.map((item) => item.sizeLabel))]),
      finance: permissions.canViewFinance ? finances.get(row.id) ?? null : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  });
  const total = totals[0]?.total ?? 0;
  return Object.freeze({
    items: Object.freeze(items),
    total,
    page: filters.page,
    pageSize: filters.pageSize,
    pageCount: Math.ceil(total / filters.pageSize),
  });
}

export async function getProductionJobDetail(
  database: Database,
  jobId: string,
  permissions: Readonly<{ canViewFinance: boolean }>,
) {
  const [row] = await database.select({
    job: productionJobs,
    orderNumber: orders.orderNumber,
    orderStatus: orders.fulfilmentStatus,
    orderPaymentStatus: orders.paymentStatus,
  }).from(productionJobs)
    .leftJoin(orders, eq(orders.id, productionJobs.orderId))
    .where(eq(productionJobs.id, jobId))
    .limit(1);
  if (!row) return null;

  const [items, assigneeRows, customFieldRows, auditRows, financeRows] = await Promise.all([
    database.select().from(productionJobItems)
      .where(eq(productionJobItems.jobId, jobId))
      .orderBy(productionJobItems.position),
    row.job.assignedUserId
      ? database.select({ id: user.id, name: user.name, email: user.email })
        .from(user).where(eq(user.id, row.job.assignedUserId)).limit(1)
      : Promise.resolve([]),
    database.select({
      id: productionFieldDefinitions.id,
      fieldKey: productionFieldDefinitions.fieldKey,
      label: productionFieldDefinitions.label,
      fieldType: productionFieldDefinitions.fieldType,
      section: productionFieldDefinitions.section,
      options: productionFieldDefinitions.options,
      required: productionFieldDefinitions.required,
      legacyOnly: productionFieldDefinitions.legacyOnly,
      value: productionFieldValues.value,
    }).from(productionFieldDefinitions)
      .leftJoin(productionFieldValues, and(
        eq(productionFieldValues.fieldId, productionFieldDefinitions.id),
        eq(productionFieldValues.jobId, jobId),
      ))
      .where(and(
        eq(productionFieldDefinitions.enabled, true),
        eq(productionFieldDefinitions.showOnDetail, true),
      ))
      .orderBy(asc(productionFieldDefinitions.sortOrder), asc(productionFieldDefinitions.label)),
    database.select({
      ...getTableColumns(adminAuditLogs),
      actorName: user.name,
    }).from(adminAuditLogs)
      .leftJoin(user, eq(user.id, adminAuditLogs.actorUserId))
      .where(and(
        eq(adminAuditLogs.resourceType, "production_job"),
        eq(adminAuditLogs.resourceId, jobId),
      ))
      .orderBy(desc(adminAuditLogs.createdAt)),
    permissions.canViewFinance
      ? database.select({
          amountPayableCents: productionJobs.amountPayableCents,
          amountPaidCents: productionJobs.amountPaidCents,
          artistFeeCents: productionJobs.artistFeeCents,
          materialCostCents: productionJobs.materialCostCents,
          orderTotalInclGstCents: orders.totalInclGstCents,
        }).from(productionJobs)
          .leftJoin(orders, eq(orders.id, productionJobs.orderId))
          .where(eq(productionJobs.id, jobId)).limit(1)
      : Promise.resolve([]),
  ]);
  let finance: FinanceProjection | null = null;
  if (permissions.canViewFinance && financeRows[0]) {
    finance = row.job.source === "web"
      ? projectWebOrderFinance(
          financeRows[0].orderTotalInclGstCents ?? 0,
          row.orderPaymentStatus ?? "awaiting_payment",
        )
      : manualFinance({
          amountPayableCents: financeRows[0].amountPayableCents ?? 0,
          amountPaidCents: financeRows[0].amountPaidCents ?? 0,
          artistFeeCents: financeRows[0].artistFeeCents ?? 0,
          materialCostCents: financeRows[0].materialCostCents ?? 0,
        });
  }
  return Object.freeze({
    job: row.job,
    orderNumber: row.orderNumber,
    status: row.orderStatus ?? row.job.manualStatus ?? "new",
    paymentStatus:
      row.orderPaymentStatus ?? row.job.manualPaymentStatus ?? "awaiting_payment",
    assignee: assigneeRows[0] ?? null,
    items: Object.freeze(items),
    finance,
    customFields: Object.freeze(customFieldRows.filter((field) =>
      permissions.canViewFinance || field.section !== "finance"
    ).map((field) => Object.freeze({ ...field, value: field.value ?? "" }))),
    audit: Object.freeze(auditRows),
  });
}

export function createDrizzleProductionJobRepository(
  database: Database,
  options: Readonly<{
    conversionPolicy?: ConversionActivationPolicy;
    enqueueDeliveries?: typeof enqueueConversionDeliveries;
    analyticsRecorder?: Pick<
      WebsiteAnalyticsV2BusinessRecorder,
      "recordManualOrder" | "recordManualPaymentUpdate"
    >;
  }> = {},
): ProductionJobRepository {
  const conversionPolicy = options.conversionPolicy
    ?? parseConversionActivationPolicy(process.env);
  const enqueueDeliveries = options.enqueueDeliveries
    ?? enqueueConversionDeliveries;
  const analyticsRecorder = options.analyticsRecorder
    ?? createWebsiteAnalyticsV2BusinessRecorder(database);
  return {
    async findManualByIdempotencyKey(idempotencyKey) {
      const [record] = await database.select({
        id: productionJobs.id,
        jobNumber: productionJobs.jobNumber,
        requestDigest: productionJobs.requestDigest,
        updatedAt: productionJobs.updatedAt,
      }).from(productionJobs)
        .where(eq(productionJobs.idempotencyKey, idempotencyKey))
        .limit(1);
      return record?.requestDigest ? {
        id: record.id,
        jobNumber: record.jobNumber,
        requestDigest: record.requestDigest,
        updatedAt: record.updatedAt,
      } : null;
    },

    async createManual(input) {
      const created = await database.transaction(async (transaction) => {
        const availableFields = await transaction.select().from(productionFieldDefinitions)
          .where(and(
            eq(productionFieldDefinitions.enabled, true),
            eq(productionFieldDefinitions.showOnCreate, true),
          ));
        const availableById = new Map(availableFields.map((field) => [field.id, field]));
        const submittedById = new Map(input.customFields.map((field) => [field.fieldId, field.value]));
        for (const submitted of input.customFields) {
          const definition = availableById.get(submitted.fieldId);
          if (!definition || definition.legacyOnly || definition.fieldType === "file") {
            throw new ProductionJobValidationError("Custom field is not available for manual entry");
          }
          if (definition.section === "finance" && !input.canUpdateFinance) {
            throw new ProductionJobValidationError("Finance permission is required");
          }
          if ((definition.fieldType === "select" || definition.fieldType === "radio") && !definition.options.includes(submitted.value)) {
            throw new ProductionJobValidationError("Custom field option is invalid");
          }
          if (definition.fieldType === "number" && submitted.value && !/^-?\d+(?:\.\d+)?$/.test(submitted.value)) {
            throw new ProductionJobValidationError("Custom number field is invalid");
          }
          if (definition.fieldType === "date" && submitted.value && !/^\d{4}-\d{2}-\d{2}$/.test(submitted.value)) {
            throw new ProductionJobValidationError("Custom date field is invalid");
          }
        }
        if (availableFields.some((field) => field.required &&
          (field.section !== "finance" || input.canUpdateFinance) &&
          !(submittedById.get(field.id) ?? "").trim())) {
          throw new ProductionJobValidationError("Required custom field is missing");
        }
        const [job] = await transaction.insert(productionJobs).values({
          jobNumber: input.jobNumber,
          source: "manual",
          idempotencyKey: input.idempotencyKey,
          requestDigest: input.requestDigest,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone,
          customerSource: input.customerSource,
          webOrderNumber: input.webOrderNumber,
          manualStatus: input.manualStatus,
          manualPaymentStatus: input.manualPaymentStatus,
          ...(input.manualPaymentStatus === "paid"
            ? { manualPaymentConfirmedAt: sql`statement_timestamp()` }
            : {}),
          urgent: input.urgent,
          neededDate: input.neededDate,
          deliveryMethod: input.deliveryMethod,
          deliveryAddress: input.deliveryAddress,
          paymentReconciliationStatus: input.paymentReconciliationStatus,
          assignedUserId: input.assignedUserId,
          designRequirements: input.designRequirements,
          internalNotes: input.internalNotes,
          amountPayableCents: input.amountPayableCents,
          amountPaidCents: input.amountPaidCents,
          artistFeeCents: input.artistFeeCents,
          materialCostCents: input.materialCostCents,
          artistPaidAt: input.artistPaidAt,
          fileSentAt: input.fileSentAt,
          downloadedAt: input.downloadedAt,
          printedAt: input.printedAt,
          customerNotifiedAt: input.customerNotifiedAt,
          deliveredAt: input.deliveredAt,
          completedAt: input.completedAt,
          createdByUserId: input.actor.userId,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        }).returning({
          id: productionJobs.id,
          jobNumber: productionJobs.jobNumber,
          requestDigest: productionJobs.requestDigest,
          updatedAt: productionJobs.updatedAt,
        });
        await transaction.insert(productionJobItems).values(
          input.items.map((item) => ({ ...item, jobId: job.id })),
        );
        if (input.customFields.length) {
          await transaction.insert(productionFieldValues).values(input.customFields.map((field) => ({
            jobId: job.id,
            fieldId: field.fieldId,
            value: field.value,
            updatedByUserId: input.actor.userId,
            createdAt: input.createdAt,
            updatedAt: input.createdAt,
          })));
        }
        if (input.conversionEvidence) {
          await writeManualConversionEvidence(transaction, {
            jobId: job.id,
            actor: input.actor,
            ...input.conversionEvidence,
          });
        }
        if (input.invoice) {
          const [invoice] = await transaction.insert(invoices).values({
            jobId: job.id,
            invoiceNumber: input.invoice.invoiceNumber,
            status: "draft",
            invoiceDate: input.invoice.invoiceDate,
            dueDate: input.invoice.dueDate,
            reference: input.invoice.reference,
            webOrderNumber: input.webOrderNumber,
            businessName: input.invoice.businessName,
            businessAddress: input.invoice.businessAddress,
            businessEmail: input.invoice.businessEmail,
            businessPhone: input.invoice.businessPhone,
            businessWebsite: input.invoice.businessWebsite,
            gstNumber: input.invoice.gstNumber,
            bankAccount: input.invoice.bankAccount,
            customerName: input.invoice.customerName,
            customerEmail: input.invoice.customerEmail,
            customerAddress: input.invoice.customerAddress,
            deliveryAddress: input.invoice.deliveryAddress,
            currency: input.invoice.currency,
            gstRateBasisPoints: input.invoice.gstRateBasisPoints,
            pricesIncludeGst: true,
            grossCents: input.invoice.grossCents,
            discountCents: input.invoice.discountCents,
            subtotalExGstCents: input.invoice.subtotalExGstCents,
            gstCents: input.invoice.gstCents,
            totalInclGstCents: input.invoice.totalInclGstCents,
            notes: input.invoice.notes,
            terms: input.invoice.terms,
            createdByUserId: input.actor.userId,
            updatedByUserId: input.actor.userId,
            createdAt: input.createdAt,
            updatedAt: input.createdAt,
          }).returning({ id: invoices.id });
          await transaction.insert(invoiceItems).values(input.invoice.items.map((item, position) => ({
            invoiceId: invoice.id,
            position,
            code: item.code,
            description: item.description,
            quantityMilli: item.quantityMilli,
            rateInclGstCents: item.rateInclGstCents,
            lineTotalInclGstCents: Math.round(item.quantityMilli * item.rateInclGstCents / 1_000),
          })));
          await transaction.insert(adminAuditLogs).values(buildAuditRecord({
            actorUserId: input.actor.userId,
            actorEmail: input.actor.email,
            action: "invoice.created",
            resourceType: "invoice",
            resourceId: invoice.id,
            afterSummary: { jobId: job.id, invoiceNumber: input.invoice.invoiceNumber, totalInclGstCents: input.invoice.totalInclGstCents },
            requestSource: "admin.jobs.manual",
            result: "success",
            idempotencyKey: `invoice-created:${job.id}`,
          }));
        }
        if (input.conversionEvidence) {
          await enqueueAuthoritativeManualOrderFinalization(
            transaction,
            {
              jobId: job.id,
              finalizedAt: input.createdAt,
              customerSource: input.customerSource,
              customerEmail: input.customerEmail,
              customerPhone: input.customerPhone,
              webOrderNumber: input.webOrderNumber,
              valueMinor: input.amountPayableCents,
              currency: input.invoice?.currency ?? "NZD",
              conversionEvidence: {
                jobId: job.id,
                actor: input.actor,
                ...input.conversionEvidence,
              },
            },
            conversionPolicy,
            enqueueDeliveries,
          );
        }
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: input.actor.userId,
          actorEmail: input.actor.email,
          action: "production_job.created",
          resourceType: "production_job",
          resourceId: job.id,
          afterSummary: {
            jobNumber: job.jobNumber,
            source: "manual",
            urgent: input.urgent,
            itemCount: input.items.length,
            customFieldCount: input.customFields.length,
          },
          requestSource: "admin.jobs.manual",
          result: "success",
          idempotencyKey: input.idempotencyKey,
        }));
        await enqueueInternalNotifications(transaction, {
          topic: "manual_order_created",
          sourceEventId: job.id,
          resourceType: "production_job",
          resourceId: job.id,
          resourceReference: job.jobNumber,
          payload: { version: 1, adminPath: `/admin/jobs/${job.id}` },
          createdAt: input.createdAt,
        });
        return {
          id: job.id,
          jobNumber: job.jobNumber,
          requestDigest: job.requestDigest!,
          updatedAt: job.updatedAt,
        };
      }).catch(async (error) => {
        const existing = await this.findManualByIdempotencyKey(input.idempotencyKey);
        if (!existing) throw error;
        if (existing.requestDigest !== input.requestDigest) {
          throw new ProductionJobConflictError();
        }
        return existing;
      });
      try {
        await analyticsRecorder.recordManualOrder({
          jobId: created.id,
          occurredAt: created.updatedAt,
          amountPayableCents: input.amountPayableCents,
          amountPaidCents: input.amountPaidCents,
          initialStatus: input.manualStatus,
          currency: input.invoice?.currency ?? "NZD",
        });
      } catch {
        // The committed manual order remains authoritative; reconciliation repairs analytics.
      }
      return created;
    },

    async update(input) {
      const [priorAudit] = await database.select({ id: adminAuditLogs.id })
        .from(adminAuditLogs)
        .where(and(
          eq(adminAuditLogs.actorUserId, input.actor.userId),
          eq(adminAuditLogs.action, "production_job.updated"),
          eq(adminAuditLogs.idempotencyKey, input.idempotencyKey),
        )).limit(1);
      if (priorAudit) return "duplicate" as const;

      let paidDeltaCents = 0;
      const result = await database.transaction(async (transaction) => {
        const [current] = await transaction.select().from(productionJobs)
          .where(eq(productionJobs.id, input.jobId)).for("update").limit(1);
        if (!current) return "not_found" as const;
        if (current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
          return "conflict" as const;
        }
        if (current.source === "web" && (
          input.manualStatus || input.finance || input.customerName !== undefined ||
          input.customerEmail !== undefined || input.customerPhone !== undefined || input.items
        )) {
          return "invalid_source" as const;
        }
        if (input.assignedUserId) {
          const [assignee] = await transaction.select({ role: user.role }).from(user)
            .where(eq(user.id, input.assignedUserId)).limit(1);
          if (!assignee || !["admin", "staff", "form_staff"].includes(assignee.role)) {
            return "invalid_source" as const;
          }
        }

        const currentItems = input.items
          ? await transaction.select({
              productTitle: productionJobItems.productTitle,
              sizeLabel: productionJobItems.sizeLabel,
              quantity: productionJobItems.quantity,
              designText: productionJobItems.designText,
              notes: productionJobItems.notes,
            }).from(productionJobItems)
              .where(eq(productionJobItems.jobId, input.jobId))
              .orderBy(asc(productionJobItems.position))
          : [];
        const changes: ProductionJobAuditChange[] = [...productionJobAuditChanges(
          current,
          { ...input, ...(input.finance ?? {}) },
          currentItems,
          input.items,
        )];
        const values: Partial<typeof productionJobs.$inferInsert> = {
          updatedAt: input.updatedAt,
        };
        for (const [key, value] of [
          ["customerName", input.customerName],
          ["customerEmail", input.customerEmail],
          ["customerPhone", input.customerPhone],
          ["assignedUserId", input.assignedUserId],
          ["urgent", input.urgent],
          ["customerSource", input.customerSource],
          ["neededDate", input.neededDate],
          ["deliveryMethod", input.deliveryMethod],
          ["deliveryAddress", input.deliveryAddress],
          ["paymentReconciliationStatus", input.paymentReconciliationStatus],
          ["designRequirements", input.designRequirements],
          ["internalNotes", input.internalNotes],
          ["manualStatus", input.manualStatus],
          ["fileSentAt", input.fileSentAt],
          ["downloadedAt", input.downloadedAt],
          ["printedAt", input.printedAt],
          ["customerNotifiedAt", input.customerNotifiedAt],
          ["deliveredAt", input.deliveredAt],
          ["artistPaidAt", input.artistPaidAt],
          ["completedAt", input.completedAt],
        ] as const) {
          if (value !== undefined) {
            Object.assign(values, { [key]: value });
          }
        }
        if (input.finance) {
          if (current.source === "manual") {
            paidDeltaCents = Math.max(0, input.finance.amountPaidCents - (current.amountPaidCents ?? 0));
          }
          const firstPaidTransition = current.source === "manual"
            && current.manualPaymentStatus !== "paid"
            && input.finance.manualPaymentStatus === "paid"
            && current.manualPaymentConfirmedAt === null;
          Object.assign(values, {
            manualPaymentStatus: input.finance.manualPaymentStatus,
            amountPayableCents: input.finance.amountPayableCents,
            amountPaidCents: input.finance.amountPaidCents,
            artistFeeCents: input.finance.artistFeeCents,
            materialCostCents: input.finance.materialCostCents,
            ...(firstPaidTransition
              ? { manualPaymentConfirmedAt: sql`statement_timestamp()` }
              : {}),
          });
        }
        if (input.customFields) {
          const definitions = await transaction.select().from(productionFieldDefinitions)
            .where(inArray(productionFieldDefinitions.id, input.customFields.map((field) => field.fieldId)));
          const definitionsById = new Map(definitions.map((field) => [field.id, field]));
          for (const field of input.customFields) {
            const definition = definitionsById.get(field.fieldId);
            if (!definition || !definition.enabled || !definition.showOnDetail || definition.legacyOnly || definition.fieldType === "file") {
              return "invalid_source" as const;
            }
            if (definition.section === "finance" && !input.canUpdateFinance) return "invalid_source" as const;
            if (definition.required && !field.value.trim()) return "invalid_source" as const;
            if ((definition.fieldType === "select" || definition.fieldType === "radio") && field.value && !definition.options.includes(field.value)) return "invalid_source" as const;
            if (definition.fieldType === "number" && field.value && !/^-?\d+(?:\.\d+)?$/.test(field.value)) return "invalid_source" as const;
            if (definition.fieldType === "date" && field.value && !/^\d{4}-\d{2}-\d{2}$/.test(field.value)) return "invalid_source" as const;
          }
          if (input.customFields.length) {
            await transaction.insert(productionFieldValues).values(input.customFields.map((field) => ({
              jobId: input.jobId,
              fieldId: field.fieldId,
              value: field.value,
              updatedByUserId: input.actor.userId,
              createdAt: input.updatedAt,
              updatedAt: input.updatedAt,
            }))).onConflictDoUpdate({
              target: [productionFieldValues.jobId, productionFieldValues.fieldId],
              set: {
                value: sql`excluded.value`,
                updatedByUserId: input.actor.userId,
                updatedAt: input.updatedAt,
              },
            });
          }
          if (input.customFields.length) changes.push({ field: "customFields" });
        }
        const [updated] = await transaction.update(productionJobs).set(values)
          .where(and(
            eq(productionJobs.id, input.jobId),
            eq(productionJobs.updatedAt, input.expectedUpdatedAt),
          )).returning({
            id: productionJobs.id,
            manualPaymentConfirmedAt: productionJobs.manualPaymentConfirmedAt,
          });
        if (!updated) return "conflict" as const;

        if (input.items) {
          await transaction.delete(productionJobItems).where(eq(productionJobItems.jobId, input.jobId));
          await transaction.insert(productionJobItems).values(input.items.map((item, position) => ({
            ...item,
            jobId: input.jobId,
            position,
          })));
        }

        const changedFields = changes.map((change) => change.field);

        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: input.actor.userId,
          actorEmail: input.actor.email,
          action: "production_job.updated",
          resourceType: "production_job",
          resourceId: input.jobId,
          beforeSummary: { updatedAt: current.updatedAt.toISOString() },
          afterSummary: {
            updatedAt: input.updatedAt.toISOString(),
            changedFields,
            changes,
          },
          requestSource: "admin.jobs.detail",
          result: "success",
          idempotencyKey: input.idempotencyKey,
        }));
        return "updated" as const;
      });
      if (result === "updated" && paidDeltaCents > 0) {
        try {
          await analyticsRecorder.recordManualPaymentUpdate({
            jobId: input.jobId,
            idempotencyKey: input.idempotencyKey,
            deltaCents: paidDeltaCents,
            currency: "NZD",
            occurredAt: input.updatedAt,
          });
        } catch {
          // The committed payment update remains authoritative; reconciliation repairs analytics.
        }
      }
      return result;
    },

    async deleteManual(input) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction.select({
          id: productionJobs.id,
          jobNumber: productionJobs.jobNumber,
          source: productionJobs.source,
        }).from(productionJobs)
          .where(eq(productionJobs.id, input.jobId))
          .for("update")
          .limit(1);
        if (!current) throw new ProductionJobNotFoundError();
        if (current.source !== "manual") {
          throw new ProductionJobValidationError("Website orders cannot be deleted here");
        }
        if (current.jobNumber !== input.expectedJobNumber) {
          throw new ProductionJobConflictError("The order reference does not match");
        }
        const deletedInvoices = await transaction.delete(invoices)
          .where(eq(invoices.jobId, input.jobId))
          .returning({ id: invoices.id });
        const files = await transaction.select({
          id: productionJobFiles.id,
          storageKey: productionJobFiles.storageKey,
        }).from(productionJobFiles)
          .where(eq(productionJobFiles.jobId, input.jobId));
        const [deleted] = await transaction.delete(productionJobs)
          .where(eq(productionJobs.id, input.jobId))
          .returning({ id: productionJobs.id });
        if (!deleted) throw new ProductionJobConflictError("The order changed before it was deleted");
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: input.actor.userId,
          actorEmail: input.actor.email,
          action: "production_job.deleted",
          resourceType: "production_job",
          resourceId: input.jobId,
          beforeSummary: {
            jobNumber: current.jobNumber,
            source: current.source,
            invoiceCount: deletedInvoices.length,
            fileCount: files.length,
          },
          requestSource: "forms.jobs.detail",
          result: "success",
          idempotencyKey: input.idempotencyKey,
        }));
        return Object.freeze({
          result: "deleted" as const,
          jobNumber: current.jobNumber,
          files: Object.freeze(files.map((file) => Object.freeze(file))),
        });
      });
    },
  };
}
