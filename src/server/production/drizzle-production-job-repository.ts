import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import {
  adminAuditLogs,
  orders,
  productionJobItems,
  productionJobs,
  productionFieldDefinitions,
  productionFieldValues,
  user,
  type OrderFulfilmentStatus,
  type OrderPaymentStatus,
} from "@/server/db/schema";
import { buildAuditRecord } from "@/server/admin/audit-service";
import {
  ProductionJobConflictError,
  ProductionJobValidationError,
  deriveManualJobFinance,
  type ProductionJobFilters,
  type ProductionJobRepository,
} from "./production-job-service";
import { projectWebOrderFinance } from "./production-job-finance";

type Database = ReturnType<typeof getDatabase>;

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
    database.select().from(adminAuditLogs)
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
): ProductionJobRepository {
  return {
    async findManualByIdempotencyKey(idempotencyKey) {
      const [record] = await database.select({
        id: productionJobs.id,
        jobNumber: productionJobs.jobNumber,
        requestDigest: productionJobs.requestDigest,
      }).from(productionJobs)
        .where(eq(productionJobs.idempotencyKey, idempotencyKey))
        .limit(1);
      return record?.requestDigest ? {
        id: record.id,
        jobNumber: record.jobNumber,
        requestDigest: record.requestDigest,
      } : null;
    },

    async createManual(input) {
      return database.transaction(async (transaction) => {
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
          completedAt: input.completedAt,
          createdByUserId: input.actor.userId,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        }).returning({
          id: productionJobs.id,
          jobNumber: productionJobs.jobNumber,
          requestDigest: productionJobs.requestDigest,
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
        return {
          id: job.id,
          jobNumber: job.jobNumber,
          requestDigest: job.requestDigest!,
        };
      }).catch(async (error) => {
        const existing = await this.findManualByIdempotencyKey(input.idempotencyKey);
        if (!existing) throw error;
        if (existing.requestDigest !== input.requestDigest) {
          throw new ProductionJobConflictError();
        }
        return existing;
      });
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

      return database.transaction(async (transaction) => {
        const [current] = await transaction.select().from(productionJobs)
          .where(eq(productionJobs.id, input.jobId)).for("update").limit(1);
        if (!current) return "not_found" as const;
        if (current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
          return "conflict" as const;
        }
        if (current.source === "web" && (input.manualStatus || input.finance)) {
          return "invalid_source" as const;
        }
        if (input.assignedUserId) {
          const [assignee] = await transaction.select({ role: user.role }).from(user)
            .where(eq(user.id, input.assignedUserId)).limit(1);
          if (!assignee || !["admin", "staff", "form_staff"].includes(assignee.role)) {
            return "invalid_source" as const;
          }
        }

        const changedFields: string[] = [];
        const values: Partial<typeof productionJobs.$inferInsert> = {
          updatedAt: input.updatedAt,
        };
        for (const [key, value] of [
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
            changedFields.push(key);
          }
        }
        if (input.finance) {
          Object.assign(values, {
            manualPaymentStatus: input.finance.manualPaymentStatus,
            amountPayableCents: input.finance.amountPayableCents,
            amountPaidCents: input.finance.amountPaidCents,
            artistFeeCents: input.finance.artistFeeCents,
            materialCostCents: input.finance.materialCostCents,
          });
          changedFields.push("finance");
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
          changedFields.push("customFields");
        }
        const [updated] = await transaction.update(productionJobs).set(values)
          .where(and(
            eq(productionJobs.id, input.jobId),
            eq(productionJobs.updatedAt, input.expectedUpdatedAt),
          )).returning({ id: productionJobs.id });
        if (!updated) return "conflict" as const;

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
          },
          requestSource: "admin.jobs.detail",
          result: "success",
          idempotencyKey: input.idempotencyKey,
        }));
        return "updated" as const;
      });
    },
  };
}
