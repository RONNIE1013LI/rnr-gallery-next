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
import { displayFormReference } from "@/domain/forms/forms-parity";
import {
  orders,
  productionJobItems,
  productionJobFiles,
  productionJobs,
  productionFieldDefinitions,
  productionFieldValues,
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
  canViewPaymentProof?: boolean;
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
  const empty = condition.operator === "isEmpty";
  const notEmpty = condition.operator === "isNotEmpty";
  const escaped = scalarValue.replaceAll("%", "\\%").replaceAll("_", "\\_");
  const textCondition = (expression: SQL<string>) => {
    if (empty) return sql`coalesce(${expression}, '') = ''`;
    if (notEmpty) return sql`coalesce(${expression}, '') <> ''`;
    if (condition.operator === "contains") return ilike(expression, `%${escaped}%`);
    if (condition.operator === "notEquals") return ne(expression, scalarValue);
    return eq(expression, scalarValue);
  };
  const numberCondition = (expression: SQL<number>) => {
    if (empty) return sql`${expression} is null`;
    if (notEmpty) return sql`${expression} is not null`;
    const cents = Math.round(Number(scalarValue) * 100);
    if (condition.operator === "greaterThan") return gt(expression, cents);
    if (condition.operator === "lessThan") return lt(expression, cents);
    if (condition.operator === "between" && typeof condition.value !== "string") {
      return and(
        gte(expression, Math.round(Number(condition.value[0]) * 100)),
        lte(expression, Math.round(Number(condition.value[1]) * 100)),
      )!;
    }
    return eq(expression, cents);
  };
  const dateCondition = (expression: SQL<string>) => {
    if (empty) return sql`${expression} is null`;
    if (notEmpty) return sql`${expression} is not null`;
    if (condition.operator === "before") return lt(expression, scalarValue);
    if (condition.operator === "after") return gt(expression, scalarValue);
    if (condition.operator === "between" && typeof condition.value !== "string") {
      return and(gte(expression, condition.value[0] ?? ""), lte(expression, condition.value[1] ?? ""))!;
    }
    return eq(expression, scalarValue);
  };

  if (condition.field.startsWith("custom:")) {
    const fieldId = condition.field.slice("custom:".length);
    const accessCondition = and(
      eq(productionFieldDefinitions.id, fieldId),
      access.canViewFinance ? undefined : ne(productionFieldDefinitions.section, "finance"),
      access.canViewCustomerContact ? undefined : ne(productionFieldDefinitions.section, "customer"),
    );
    const customValue = sql<string>`${productionFieldValues.value}`;
    let valueMatch: SQL;
    if (condition.operator === "before" || condition.operator === "after") {
      const dateValue = sql`case when ${productionFieldDefinitions.fieldType} = 'date' and ${customValue} ~ '^\\d{4}-\\d{2}-\\d{2}$' then to_date(${customValue}, 'YYYY-MM-DD') else null end`;
      valueMatch = condition.operator === "before"
        ? sql`${dateValue} < to_date(${scalarValue}, 'YYYY-MM-DD')`
        : sql`${dateValue} > to_date(${scalarValue}, 'YYYY-MM-DD')`;
    } else if (condition.operator === "greaterThan" || condition.operator === "lessThan") {
      const numericValue = sql`case when ${productionFieldDefinitions.fieldType} = 'number' and ${customValue} ~ '^\\d+(\\.\\d{1,2})?$' then ${customValue}::numeric else null end`;
      valueMatch = condition.operator === "greaterThan"
        ? sql`${numericValue} > ${Number(scalarValue)}`
        : sql`${numericValue} < ${Number(scalarValue)}`;
    } else if (condition.operator === "between" && typeof condition.value !== "string") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(condition.value[0] ?? "")) {
        const dateValue = sql`case when ${productionFieldDefinitions.fieldType} = 'date' and ${customValue} ~ '^\\d{4}-\\d{2}-\\d{2}$' then to_date(${customValue}, 'YYYY-MM-DD') else null end`;
        valueMatch = sql`${dateValue} between to_date(${condition.value[0]}, 'YYYY-MM-DD') and to_date(${condition.value[1]}, 'YYYY-MM-DD')`;
      } else {
        const numericValue = sql`case when ${productionFieldDefinitions.fieldType} = 'number' and ${customValue} ~ '^\\d+(\\.\\d{1,2})?$' then ${customValue}::numeric else null end`;
        valueMatch = sql`${numericValue} between ${Number(condition.value[0])} and ${Number(condition.value[1])}`;
      }
    } else {
      valueMatch = textCondition(customValue);
    }
    if (empty) {
      return sql`not exists (
        select 1 from ${productionFieldValues}
        inner join ${productionFieldDefinitions} on ${productionFieldDefinitions.id} = ${productionFieldValues.fieldId}
        where ${productionFieldValues.jobId} = ${productionJobs.id} and ${accessCondition}
          and coalesce(${productionFieldValues.value}, '') <> ''
      )`;
    }
    if (notEmpty) {
      return sql`exists (
        select 1 from ${productionFieldValues}
        inner join ${productionFieldDefinitions} on ${productionFieldDefinitions.id} = ${productionFieldValues.fieldId}
        where ${productionFieldValues.jobId} = ${productionJobs.id} and ${accessCondition}
          and coalesce(${productionFieldValues.value}, '') <> ''
      )`;
    }
    return sql`exists (
      select 1 from ${productionFieldValues}
      inner join ${productionFieldDefinitions} on ${productionFieldDefinitions.id} = ${productionFieldValues.fieldId}
      where ${productionFieldValues.jobId} = ${productionJobs.id} and ${accessCondition} and ${valueMatch}
    )`;
  }

  if (["customerEmail", "customerPhone", "deliveryAddress"].includes(condition.field) && !access.canViewCustomerContact) {
    return sql`false`;
  }
  if (["amountPayable", "amountPaid", "amountOwing", "artistFee", "materialCost", "bankRecon"].includes(condition.field) && !access.canViewFinance) {
    return sql`false`;
  }
  if (condition.field === "paymentProof" && !access.canViewPaymentProof) return sql`false`;

  if (condition.field === "submittedAt" || condition.field === "updatedAt") {
    const column = condition.field === "submittedAt" ? productionJobs.createdAt : productionJobs.updatedAt;
    return dateCondition(sql<string>`${column}::date`);
  }
  if (condition.field === "reference") return textCondition(sql<string>`${productionJobs.jobNumber}`);
  if (condition.field === "customerName") return textCondition(sql<string>`${productionJobs.customerName}`);
  if (condition.field === "customerEmail") return textCondition(sql<string>`${productionJobs.customerEmail}`);
  if (condition.field === "customerPhone") return textCondition(sql<string>`${productionJobs.customerPhone}`);
  if (condition.field === "deliveryAddress") return textCondition(sql<string>`${productionJobs.deliveryAddress}`);
  if (condition.field === "remark") return textCondition(sql<string>`${productionJobs.internalNotes}`);
  if (condition.field === "productTitle" || condition.field === "size" || condition.field === "designText") {
    const expression = condition.field === "productTitle"
      ? sql<string>`${productionJobItems.productTitle}`
      : condition.field === "size"
        ? sql<string>`${productionJobItems.sizeLabel}`
        : sql<string>`${productionJobItems.designText}`;
    const match = textCondition(expression);
    if (empty) return sql`not exists (select 1 from ${productionJobItems} where ${productionJobItems.jobId} = ${productionJobs.id} and coalesce(${expression}, '') <> '')`;
    if (notEmpty) return sql`exists (select 1 from ${productionJobItems} where ${productionJobItems.jobId} = ${productionJobs.id} and coalesce(${expression}, '') <> '')`;
    return sql`exists (select 1 from ${productionJobItems} where ${productionJobItems.jobId} = ${productionJobs.id} and ${match})`;
  }
  if (condition.field === "paymentProof") {
    const existsProof = sql`exists (select 1 from ${productionJobFiles} where ${productionJobFiles.jobId} = ${productionJobs.id} and ${productionJobFiles.kind} = 'payment_proof')`;
    return scalarValue === "true" ? existsProof : sql`not (${existsProof})`;
  }
  if (["fileSent", "downloaded", "printed", "completed", "customerNotified", "delivered"].includes(condition.field)) {
    const column = condition.field === "fileSent" ? productionJobs.fileSentAt
      : condition.field === "downloaded" ? productionJobs.downloadedAt
        : condition.field === "printed" ? productionJobs.printedAt
          : condition.field === "completed" ? productionJobs.completedAt
            : condition.field === "customerNotified" ? productionJobs.customerNotifiedAt
              : productionJobs.deliveredAt;
    return scalarValue === "true" ? sql`${column} is not null` : sql`${column} is null`;
  }
  if (condition.field === "amountPayable") {
    return numberCondition(sql<number>`coalesce(${productionJobs.amountPayableCents}, ${orders.totalInclGstCents})`);
  }
  if (condition.field === "amountPaid") {
    return numberCondition(sql<number>`coalesce(${productionJobs.amountPaidCents}, case when ${orders.paymentStatus} = 'paid' then ${orders.totalInclGstCents} else 0 end)`);
  }
  if (condition.field === "amountOwing") {
    return numberCondition(sql<number>`coalesce(${productionJobs.amountPayableCents}, ${orders.totalInclGstCents}, 0) - coalesce(${productionJobs.amountPaidCents}, case when ${orders.paymentStatus} = 'paid' then ${orders.totalInclGstCents} else 0 end, 0)`);
  }
  if (condition.field === "artistFee") return numberCondition(sql<number>`${productionJobs.artistFeeCents}`);
  if (condition.field === "materialCost") return numberCondition(sql<number>`${productionJobs.materialCostCents}`);
  if (condition.field === "submittedByUserId") {
    if (empty) return isNull(productionJobs.createdByUserId);
    if (notEmpty) return sql`${productionJobs.createdByUserId} is not null`;
    return condition.operator === "notEquals" ? ne(productionJobs.createdByUserId, scalarValue) : eq(productionJobs.createdByUserId, scalarValue);
  }
  if (condition.field === "urgent") {
    return eq(productionJobs.urgent, scalarValue === "true");
  }
  if (condition.field === "neededDate") return dateCondition(sql<string>`${productionJobs.neededDate}`);
  if (condition.field === "assignedUserId") {
    if (empty) return isNull(productionJobs.assignedUserId);
    if (notEmpty) return sql`${productionJobs.assignedUserId} is not null`;
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
  return textCondition(expression);
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
      ...(access.canViewCustomerContact ? [
        ilike(productionJobs.customerEmail, pattern),
        ilike(productionJobs.customerPhone, pattern),
      ] : []),
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
      reference: displayFormReference(row.source, row.jobNumber),
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
