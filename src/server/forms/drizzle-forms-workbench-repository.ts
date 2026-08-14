import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import type { getDatabase } from "@/server/db/client";
import {
  orders,
  productionJobItems,
  productionJobs,
  user,
} from "@/server/db/schema";
import { projectWebOrderFinance } from "@/server/production/production-job-finance";
import { deriveManualJobFinance } from "@/server/production/production-job-service";
import type {
  FormOrderRow,
  FormFilterCondition,
  FormWorkbenchQuery,
  FormWorkbenchResult,
} from "./forms-workbench-service";

type Database = ReturnType<typeof getDatabase>;

export type FormWorkbenchAccess = Readonly<{
  actorUserId: string;
  assignedOnly: boolean;
  canViewCustomerContact: boolean;
  canViewFinance: boolean;
}>;

function presetStart(preset: FormWorkbenchQuery["preset"]) {
  if (preset === "all") return null;
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  if (preset === "lastSixMonths") start.setUTCMonth(start.getUTCMonth() - 6);
  else start.setUTCFullYear(start.getUTCFullYear() - 1);
  return start;
}

function filterCondition(
  condition: FormFilterCondition,
  access: FormWorkbenchAccess,
): SQL {
  const scalarValue = typeof condition.value === "string" ? condition.value : condition.value[0] ?? "";
  if (condition.field === "urgent") {
    return eq(productionJobs.urgent, scalarValue === "true");
  }
  if (condition.field === "neededDate") {
    if (condition.operator === "before") return lt(productionJobs.neededDate, scalarValue);
    if (condition.operator === "after") return gt(productionJobs.neededDate, scalarValue);
    if (condition.operator === "between" && typeof condition.value !== "string") {
      return and(
        gte(productionJobs.neededDate, condition.value[0] ?? ""),
        lte(productionJobs.neededDate, condition.value[1] ?? ""),
      )!;
    }
    return eq(productionJobs.neededDate, scalarValue);
  }
  if (condition.field === "assignedUserId") {
    if (condition.operator === "isEmpty") return isNull(productionJobs.assignedUserId);
    return condition.operator === "notEquals"
      ? ne(productionJobs.assignedUserId, scalarValue)
      : eq(productionJobs.assignedUserId, scalarValue);
  }
  if (condition.field === "bankRecon" && !access.canViewFinance) return sql`false`;
  const expression = condition.field === "deliveryMethod"
    ? sql<string>`${productionJobs.deliveryMethod}`
    : condition.field === "customerSource"
      ? sql<string>`${productionJobs.customerSource}`
      : condition.field === "bankRecon"
        ? sql<string>`${productionJobs.paymentReconciliationStatus}`
        : condition.field === "status"
          ? sql<string>`coalesce(${orders.fulfilmentStatus}, ${productionJobs.manualStatus}, 'new')`
          : sql<string>`coalesce(${orders.paymentStatus}, ${productionJobs.manualPaymentStatus}, 'awaiting_payment')`;
  return condition.operator === "notEquals"
    ? ne(expression, scalarValue)
    : eq(expression, scalarValue);
}

export function buildFormWorkbenchConditions(query: FormWorkbenchQuery, access: FormWorkbenchAccess) {
  const conditions: SQL[] = [];
  if (query.query) {
    const escaped = query.query.replaceAll("%", "\\%").replaceAll("_", "\\_");
    const pattern = `%${escaped}%`;
    conditions.push(or(
      ilike(productionJobs.jobNumber, pattern),
      ilike(productionJobs.webOrderNumber, pattern),
      ilike(productionJobs.customerName, pattern),
      ilike(productionJobs.customerEmail, pattern),
      ilike(productionJobs.customerPhone, pattern),
    )!);
  }
  if (access.assignedOnly) {
    conditions.push(eq(productionJobs.assignedUserId, access.actorUserId));
  }
  const start = presetStart(query.preset);
  if (start) conditions.push(gte(productionJobs.createdAt, start));
  if (query.conditions.length) {
    const filters = query.conditions.map((condition) => filterCondition(condition, access));
    conditions.push((query.match === "or" ? or(...filters) : and(...filters))!);
  }
  return conditions;
}

function sortExpression(query: FormWorkbenchQuery) {
  if (query.sort === "updatedAt") return productionJobs.updatedAt;
  if (query.sort === "neededDate") return productionJobs.neededDate;
  if (query.sort === "reference") return productionJobs.jobNumber;
  return productionJobs.createdAt;
}

export async function listFormOrders(
  database: Database,
  query: FormWorkbenchQuery,
  access: FormWorkbenchAccess,
): Promise<FormWorkbenchResult> {
  const conditions = buildFormWorkbenchConditions(query, access);
  const where = conditions.length ? and(...conditions) : undefined;
  const order = query.direction === "asc" ? asc : desc;
  const [rows, totalRows] = await Promise.all([
    database.select({
      id: productionJobs.id,
      jobNumber: productionJobs.jobNumber,
      source: productionJobs.source,
      orderNumber: orders.orderNumber,
      webOrderNumber: productionJobs.webOrderNumber,
      customerName: productionJobs.customerName,
      customerEmail: access.canViewCustomerContact
        ? productionJobs.customerEmail
        : sql<string | null>`null`,
      customerPhone: access.canViewCustomerContact
        ? productionJobs.customerPhone
        : sql<string | null>`null`,
      customerSource: productionJobs.customerSource,
      urgent: productionJobs.urgent,
      neededDate: productionJobs.neededDate,
      deliveryMethod: productionJobs.deliveryMethod,
      assignedUserId: productionJobs.assignedUserId,
      createdByUserId: productionJobs.createdByUserId,
      manualStatus: productionJobs.manualStatus,
      orderStatus: orders.fulfilmentStatus,
      manualPaymentStatus: productionJobs.manualPaymentStatus,
      orderPaymentStatus: orders.paymentStatus,
      internalNotes: productionJobs.internalNotes,
      fileSentAt: productionJobs.fileSentAt,
      downloadedAt: productionJobs.downloadedAt,
      customerNotifiedAt: productionJobs.customerNotifiedAt,
      printedAt: productionJobs.printedAt,
      completedAt: productionJobs.completedAt,
      deliveredAt: productionJobs.deliveredAt,
      bankRecon: access.canViewFinance
        ? productionJobs.paymentReconciliationStatus
        : sql<string | null>`null`,
      createdAt: productionJobs.createdAt,
      updatedAt: productionJobs.updatedAt,
    }).from(productionJobs)
      .leftJoin(orders, eq(orders.id, productionJobs.orderId))
      .where(where)
      .orderBy(order(sortExpression(query)), desc(productionJobs.jobNumber))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    database.select({ total: count() })
      .from(productionJobs)
      .leftJoin(orders, eq(orders.id, productionJobs.orderId))
      .where(where),
  ]);

  const jobIds = rows.map((row) => row.id);
  const userIds = [...new Set(rows.flatMap((row) => [
    ...(row.assignedUserId ? [row.assignedUserId] : []),
    ...(row.createdByUserId ? [row.createdByUserId] : []),
  ]))];
  const [items, people, finances] = await Promise.all([
    jobIds.length
      ? database.select({
          jobId: productionJobItems.jobId,
          sizeLabel: productionJobItems.sizeLabel,
          position: productionJobItems.position,
        }).from(productionJobItems)
          .where(inArray(productionJobItems.jobId, jobIds))
          .orderBy(asc(productionJobItems.position))
      : Promise.resolve([]),
    userIds.length
      ? database.select({ id: user.id, name: user.name })
          .from(user)
          .where(inArray(user.id, userIds))
      : Promise.resolve([]),
    access.canViewFinance && jobIds.length
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

  const names = new Map(people.map((person) => [person.id, person.name]));
  type FinanceProjection = NonNullable<FormOrderRow["finance"]>;
  const finance = new Map<string, FinanceProjection>(finances.map((row) => {
    if (row.source === "web") {
      const projected = projectWebOrderFinance(
        row.orderTotalInclGstCents ?? 0,
        row.orderPaymentStatus ?? "awaiting_payment",
      );
      return [row.id, {
        amountOwingCents: projected.amountOwingCents,
        amountPaidCents: projected.amountPaidCents,
        amountPayableCents: projected.amountPayableCents,
        artistFeeCents: projected.artistFeeCents,
      }] as [string, FinanceProjection];
    }
    const projected = deriveManualJobFinance({
      amountPayableCents: row.amountPayableCents ?? 0,
      amountPaidCents: row.amountPaidCents ?? 0,
      artistFeeCents: row.artistFeeCents ?? 0,
      materialCostCents: row.materialCostCents ?? 0,
    });
    return [row.id, {
      amountOwingCents: projected.amountOwingCents,
      amountPaidCents: row.amountPaidCents ?? 0,
      amountPayableCents: row.amountPayableCents ?? 0,
      artistFeeCents: row.artistFeeCents ?? 0,
    }] as [string, FinanceProjection];
  }));

  const projectedRows: FormOrderRow[] = rows.map((row) => {
    const sizes = [...new Set(items
      .filter((item) => item.jobId === row.id)
      .map((item) => item.sizeLabel))];
    return Object.freeze({
      id: row.id,
      source: row.source,
      version: row.updatedAt.toISOString(),
      submittedAt: row.createdAt.toISOString(),
      reference: row.jobNumber,
      webOrderNumber: row.webOrderNumber || row.orderNumber || "",
      size: sizes.join(" · "),
      urgent: row.urgent,
      neededDate: row.neededDate,
      deliveryMethod: row.deliveryMethod,
      customerSource: row.customerSource,
      customerName: row.customerName,
      customerEmail: row.customerEmail || null,
      customerPhone: row.customerPhone || null,
      assignedUserId: row.assignedUserId,
      artistName: row.assignedUserId ? names.get(row.assignedUserId) ?? "Unassigned" : "Unassigned",
      status: row.orderStatus ?? row.manualStatus ?? "new",
      paymentStatus: row.orderPaymentStatus ?? row.manualPaymentStatus ?? "awaiting_payment",
      milestones: Object.freeze({
        fileSent: Boolean(row.fileSentAt),
        downloaded: Boolean(row.downloadedAt),
        customerNotified: Boolean(row.customerNotifiedAt),
        printed: Boolean(row.printedAt),
        completed: Boolean(row.completedAt),
        delivered: Boolean(row.deliveredAt),
      }),
      bankRecon: row.bankRecon,
      finance: access.canViewFinance ? finance.get(row.id) ?? null : null,
      remark: row.internalNotes,
      submittedBy: row.createdByUserId ? names.get(row.createdByUserId) ?? "Unknown" : "System",
    });
  });
  const total = Number(totalRows[0]?.total ?? 0);
  return Object.freeze({
    items: Object.freeze(projectedRows),
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.ceil(total / query.pageSize),
  });
}
