import { and, asc, count, desc, eq, sql, type SQL } from "drizzle-orm";

import type { getDatabase } from "@/server/db/client";
import { orders, productionJobItems, productionJobs, user } from "@/server/db/schema";
import type { FormWorkbenchQuery } from "./forms-workbench-service";
import { buildFormWorkbenchConditions, type FormWorkbenchAccess } from "./drizzle-forms-workbench-repository";
import type {
  FormStatDimension,
  FormStatMeasure,
  FormStatMetric,
  FormStatRequest,
  FormStatSort,
} from "./forms-stats-service";

type Database = ReturnType<typeof getDatabase>;
type StatisticRow = Readonly<{ label: string; value: number }>;
type CategoryDimension = Exclude<FormStatDimension, "submitted_at" | "needed_date">;

export type FormStatistic = Readonly<{
  metric?: FormStatMetric;
  query?: FormStatRequest;
  value?: number;
  rows?: readonly StatisticRow[];
}>;

function numeric(value: unknown) {
  return Number(value ?? 0);
}

const payable = sql<number>`case
  when ${productionJobs.source} = 'web' then coalesce(${orders.totalInclGstCents}, 0)
  else coalesce(${productionJobs.amountPayableCents}, 0)
end`;

const paid = sql<number>`case
  when ${productionJobs.source} = 'web' then case
    when ${orders.paymentStatus} in ('paid', 'refunded') then coalesce(${orders.totalInclGstCents}, 0)
    else 0
  end
  else coalesce(${productionJobs.amountPaidCents}, 0)
end`;

const owing = sql<number>`case
  when ${productionJobs.source} = 'web' then case
    when ${orders.paymentStatus} in ('awaiting_payment', 'processing', 'failed') then coalesce(${orders.totalInclGstCents}, 0)
    else 0
  end
  else coalesce(${productionJobs.amountPayableCents}, 0) - coalesce(${productionJobs.amountPaidCents}, 0)
end`;

const measureExpressions: Readonly<Record<Exclude<FormStatMeasure, "order_count">, SQL<number>>> = {
  amount_payable: payable,
  amount_paid: paid,
  amount_owing: owing,
  artist_fee: sql<number>`coalesce(${productionJobs.artistFeeCents}, 0)`,
  material_cost: sql<number>`coalesce(${productionJobs.materialCostCents}, 0)`,
  actual_profit: sql<number>`case
    when ${productionJobs.source} = 'web' then 0
    else coalesce(${productionJobs.amountPaidCents}, 0) - coalesce(${productionJobs.artistFeeCents}, 0) - coalesce(${productionJobs.materialCostCents}, 0)
  end`,
};

const categoryDimensionExpressions: Readonly<Record<CategoryDimension, SQL<string>>> = {
  size: sql<string>`coalesce((
    select string_agg(distinct ${productionJobItems.sizeLabel}, ' · ' order by ${productionJobItems.sizeLabel})
    from ${productionJobItems}
    where ${productionJobItems.jobId} = ${productionJobs.id}
  ), 'Unspecified')`,
  urgent: sql<string>`case when ${productionJobs.urgent} then 'Yes' else 'No' end`,
  delivery_method: sql<string>`coalesce(${productionJobs.deliveryMethod}, 'Unspecified')`,
  customer_source: sql<string>`coalesce(${productionJobs.customerSource}, 'Unspecified')`,
  assign_artist: sql<string>`case when ${productionJobs.assignedUserId} is null then 'No' else 'Yes' end`,
  artist: sql<string>`coalesce(${user.name}, 'Unspecified')`,
  file_sent: sql<string>`case when ${productionJobs.fileSentAt} is null then 'No' else 'Yes' end`,
  downloaded: sql<string>`case when ${productionJobs.downloadedAt} is null then 'No' else 'Yes' end`,
  customer_notified: sql<string>`case when ${productionJobs.customerNotifiedAt} is null then 'No' else 'Yes' end`,
  printed: sql<string>`case when ${productionJobs.printedAt} is null then 'No' else 'Yes' end`,
  completed: sql<string>`case when ${productionJobs.completedAt} is null then 'No' else 'Yes' end`,
  delivered: sql<string>`case when ${productionJobs.deliveredAt} is null then 'No' else 'Yes' end`,
  status: sql<string>`coalesce(${orders.fulfilmentStatus}, ${productionJobs.manualStatus}, 'new')`,
  bank_recon: sql<string>`coalesce(${productionJobs.paymentReconciliationStatus}, 'Unspecified')`,
};

function dateBucket(column: SQL, timeUnit: NonNullable<FormStatRequest["timeUnit"]>) {
  const AucklandTime = sql`${column} at time zone 'Pacific/Auckland'`;
  if (timeUnit === "day") return sql<string>`to_char(date_trunc('day', ${AucklandTime}), 'YYYY-MM-DD')`;
  if (timeUnit === "week") return sql<string>`to_char(date_trunc('week', ${AucklandTime}), 'IYYY "W"IW')`;
  return sql<string>`to_char(date_trunc('month', ${AucklandTime}), 'YYYY-MM')`;
}

function dimensionExpression(request: FormStatRequest) {
  if (request.dimension === "submitted_at") {
    if (!request.timeUnit) throw new Error("A time unit is required for submitted_at statistics.");
    return dateBucket(sql`${productionJobs.createdAt}`, request.timeUnit);
  }
  if (request.dimension === "needed_date") {
    if (!request.timeUnit) throw new Error("A time unit is required for needed_date statistics.");
    return dateBucket(sql`to_date(${productionJobs.neededDate}, 'YYYY-MM-DD')`, request.timeUnit);
  }
  if (!request.dimension) return null;
  const expression = categoryDimensionExpressions[request.dimension];
  if (!expression) throw new Error("Unsupported statistic dimension.");
  return expression;
}

function aggregateExpression(request: FormStatRequest) {
  if (request.measure === "order_count") return count();
  const expression = measureExpressions[request.measure];
  if (request.aggregation === "sum") return sql<number>`coalesce(sum(${expression}), 0)`;
  return sql<number>`coalesce(round(avg(${expression})), 0)`;
}

function groupedLimit(request: FormStatRequest) {
  if (request.dimension === "submitted_at" || request.dimension === "needed_date") {
    return request.timeUnit === "day" ? 366 : 60;
  }
  return 24;
}

function groupedOrder(label: SQL<string>, value: SQL<number>, sort: FormStatSort) {
  if (sort === "label_desc") return [desc(label)];
  if (sort === "value_asc") return [asc(value), asc(label)];
  if (sort === "value_desc") return [desc(value), asc(label)];
  return [asc(label)];
}

function resolvedQuery(request: FormStatRequest): FormStatRequest {
  return Object.freeze({
    ...(request.dimension ? { dimension: request.dimension } : {}),
    ...(request.timeUnit ? { timeUnit: request.timeUnit } : {}),
    measure: request.measure,
    aggregation: request.aggregation,
    sort: request.sort,
  });
}

async function queryGroupedStatistic(
  database: Database,
  query: FormWorkbenchQuery,
  access: FormWorkbenchAccess,
  request: FormStatRequest,
): Promise<FormStatistic> {
  const conditions = buildFormWorkbenchConditions(query, access);
  const where = conditions.length ? and(...conditions) : undefined;
  const resolved = resolvedQuery(request);
  const value = aggregateExpression(resolved);
  const label = dimensionExpression(resolved);

  if (!label) {
    const [row] = await database.select({ value })
      .from(productionJobs)
      .leftJoin(orders, eq(orders.id, productionJobs.orderId))
      .leftJoin(user, eq(user.id, productionJobs.assignedUserId))
      .where(where);
    return Object.freeze({ query: resolved, value: numeric(row?.value) });
  }

  const rows = await database.select({ label, value })
    .from(productionJobs)
    .leftJoin(orders, eq(orders.id, productionJobs.orderId))
    .leftJoin(user, eq(user.id, productionJobs.assignedUserId))
    .where(where)
    .groupBy(label)
    .orderBy(...groupedOrder(label, value, resolved.sort))
    .limit(groupedLimit(resolved));
  return Object.freeze({
    query: resolved,
    rows: Object.freeze(rows.map((row) => Object.freeze({ label: row.label, value: numeric(row.value) }))),
  });
}

async function queryLegacyStatistic(
  database: Database,
  query: FormWorkbenchQuery,
  access: FormWorkbenchAccess,
  metric: FormStatMetric,
): Promise<FormStatistic> {
  const conditions = buildFormWorkbenchConditions(query, access);
  const where = conditions.length ? and(...conditions) : undefined;
  if (metric === "job_count" || metric === "urgent_count") {
    const [row] = await database.select({ value: count() })
      .from(productionJobs)
      .leftJoin(orders, eq(orders.id, productionJobs.orderId))
      .where(metric === "urgent_count" ? and(where, eq(productionJobs.urgent, true)) : where);
    return Object.freeze({ metric, value: numeric(row?.value) });
  }

  if (metric === "amount_payable_total" || metric === "amount_paid_total" || metric === "amount_owing_total") {
    const legacyPayable = sql<number>`case when ${productionJobs.source} = 'web' then coalesce(${orders.totalInclGstCents}, 0) else coalesce(${productionJobs.amountPayableCents}, 0) end`;
    const legacyPaid = sql<number>`case when ${productionJobs.source} = 'web' and ${orders.paymentStatus} = 'paid' then coalesce(${orders.totalInclGstCents}, 0) when ${productionJobs.source} = 'manual' then coalesce(${productionJobs.amountPaidCents}, 0) else 0 end`;
    const expression = metric === "amount_payable_total" ? legacyPayable
      : metric === "amount_paid_total" ? legacyPaid
        : sql<number>`greatest(${legacyPayable} - ${legacyPaid}, 0)`;
    const [row] = await database.select({ value: sql<number>`coalesce(sum(${expression}), 0)` })
      .from(productionJobs)
      .leftJoin(orders, eq(orders.id, productionJobs.orderId))
      .where(where);
    return Object.freeze({ metric, value: numeric(row?.value) });
  }

  if (metric === "daily_orders" || metric === "monthly_orders") {
    const label = metric === "daily_orders"
      ? sql<string>`to_char(date_trunc('day', ${productionJobs.createdAt} at time zone 'Pacific/Auckland'), 'YYYY-MM-DD')`
      : sql<string>`to_char(date_trunc('month', ${productionJobs.createdAt} at time zone 'Pacific/Auckland'), 'YYYY-MM')`;
    const rows = await database.select({ label, value: count() })
      .from(productionJobs)
      .leftJoin(orders, eq(orders.id, productionJobs.orderId))
      .where(where)
      .groupBy(label)
      .orderBy(desc(label))
      .limit(metric === "daily_orders" ? 366 : 60);
    return Object.freeze({ metric, rows: Object.freeze(rows.reverse().map((row) => Object.freeze({ label: row.label, value: numeric(row.value) }))) });
  }

  const label = metric === "delivery_method" ? sql<string>`${productionJobs.deliveryMethod}`
    : metric === "customer_source" ? sql<string>`${productionJobs.customerSource}`
      : sql<string>`coalesce(${orders.fulfilmentStatus}, ${productionJobs.manualStatus}, 'new')`;
  const rows = await database.select({ label, value: count() })
    .from(productionJobs)
    .leftJoin(orders, eq(orders.id, productionJobs.orderId))
    .where(where)
    .groupBy(label)
    .orderBy(desc(count()))
    .limit(24);
  return Object.freeze({ metric, rows: Object.freeze(rows.map((row) => Object.freeze({ label: row.label, value: numeric(row.value) }))) });
}

export async function queryFormStatistic(
  database: Database,
  query: FormWorkbenchQuery,
  access: FormWorkbenchAccess,
  request: FormStatRequest | FormStatMetric,
): Promise<FormStatistic> {
  return typeof request === "string"
    ? queryLegacyStatistic(database, query, access, request)
    : queryGroupedStatistic(database, query, access, request);
}
