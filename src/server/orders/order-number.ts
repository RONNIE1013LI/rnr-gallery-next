import { sql } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function formatOrderNumber(value: number | bigint) {
  const numeric = typeof value === "bigint" ? value : BigInt(value);
  if (numeric < BigInt(0)) throw new Error("Order number must be non-negative");
  return numeric.toString().padStart(5, "0");
}

export async function allocateOrderNumber(transaction: Transaction) {
  const result = await transaction.execute<{ value: string }>(sql`
    update business_number_counter
    set current_value = current_value + 1
    where key = 'order_job'
    returning current_value::text as value
  `);
  const value = result.rows[0]?.value;
  if (!value || !/^\d+$/.test(value)) {
    throw new Error("Order number allocation failed");
  }
  return formatOrderNumber(BigInt(value));
}
