import { and, count, desc, eq, sql } from "drizzle-orm";

import type { getDatabase } from "@/server/db/client";
import { orders, productionJobs } from "@/server/db/schema";
import type { FormWorkbenchQuery } from "./forms-workbench-service";
import { buildFormWorkbenchConditions, type FormWorkbenchAccess } from "./drizzle-forms-workbench-repository";
import type { FormStatMetric } from "./forms-stats-service";

type Database = ReturnType<typeof getDatabase>;
export type FormStatistic = Readonly<{
  metric: FormStatMetric;
  value?: number;
  rows?: readonly Readonly<{ label: string; value: number }>[];
}>;

function numeric(value: unknown) {
  return Number(value ?? 0);
}

export async function queryFormStatistic(
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
    const payable = sql<number>`case when ${productionJobs.source} = 'web' then coalesce(${orders.totalInclGstCents}, 0) else coalesce(${productionJobs.amountPayableCents}, 0) end`;
    const paid = sql<number>`case when ${productionJobs.source} = 'web' and ${orders.paymentStatus} = 'paid' then coalesce(${orders.totalInclGstCents}, 0) when ${productionJobs.source} = 'manual' then coalesce(${productionJobs.amountPaidCents}, 0) else 0 end`;
    const expression = metric === "amount_payable_total" ? payable
      : metric === "amount_paid_total" ? paid
        : sql<number>`greatest(${payable} - ${paid}, 0)`;
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
