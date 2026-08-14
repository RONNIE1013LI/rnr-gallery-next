import { and, count, desc, eq, gte, ilike, lte, or, type SQL } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { adminAuditLogs } from "@/server/db/schema";

type Database = ReturnType<typeof getDatabase>;

function scalar(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function validDate(value: string | undefined, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+12:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function listAdminAuditLogs(
  database: Database,
  params: Readonly<Record<string, string | string[] | undefined>>,
) {
  const pageRaw = Number(scalar(params.page));
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const pageSize = 50;
  const query = scalar(params.q)?.trim();
  const action = scalar(params.action)?.trim();
  const result = scalar(params.result);
  const from = validDate(scalar(params.from));
  const to = validDate(scalar(params.to), true);
  const conditions: SQL[] = [];
  if (query) {
    conditions.push(or(
      ilike(adminAuditLogs.actorEmail, `%${query}%`),
      ilike(adminAuditLogs.resourceId, `%${query}%`),
      ilike(adminAuditLogs.resourceType, `%${query}%`),
    )!);
  }
  if (action) conditions.push(ilike(adminAuditLogs.action, `%${action}%`));
  if (result === "success" || result === "failure") conditions.push(eq(adminAuditLogs.result, result));
  if (from) conditions.push(gte(adminAuditLogs.createdAt, from));
  if (to) conditions.push(lte(adminAuditLogs.createdAt, to));
  const where = conditions.length ? and(...conditions) : undefined;
  const [items, totals] = await Promise.all([
    database.select().from(adminAuditLogs).where(where).orderBy(desc(adminAuditLogs.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    database.select({ value: count() }).from(adminAuditLogs).where(where),
  ]);
  const total = Number(totals[0]?.value ?? 0);
  return Object.freeze({ items: Object.freeze(items), total, page, pageSize, pageCount: Math.ceil(total / pageSize) });
}
