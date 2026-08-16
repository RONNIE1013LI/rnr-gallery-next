import { sql } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";

type Database = ReturnType<typeof getDatabase>;

export function formatOrderNumber(value: number | bigint) {
  const numeric = typeof value === "bigint" ? value : BigInt(value);
  if (numeric < BigInt(0)) throw new Error("Order number must be non-negative");
  return numeric.toString().padStart(5, "0");
}

export async function allocateOrderNumber(database: Pick<Database, "execute">) {
  const result = await database.execute<{ value: string }>(sql`
    select lpad(nextval('rnr_order_number_seq')::text, 5, '0') as value
  `);
  const value = result.rows[0]?.value;
  if (!value || !/^\d{5,}$/.test(value)) {
    throw new Error("Order number allocation failed");
  }
  return value;
}
