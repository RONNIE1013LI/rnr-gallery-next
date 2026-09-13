import { sql } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { requireAdminPermission } from "@/server/auth/require-admin";

export const runtime = "nodejs";

export async function GET() {
  await requireAdminPermission("manage_roles");
  const database = getDatabase();
  const result = await database.transaction(async (transaction) => {
    const tableResult = await transaction.execute(sql`
      select to_regclass('public.manual_order_notification_outbox') as table_name
    `);
    const table = tableResult.rows[0] as { table_name?: string } | undefined;
    if (table?.table_name !== "manual_order_notification_outbox") return false;

    const columnsResult = await transaction.execute(sql`
      select count(*)::int as count
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'manual_order_notification_outbox'
        and column_name in ('event_key', 'job_id', 'recipient_email', 'status', 'attempts')
    `);
    const columns = columnsResult.rows[0] as { count?: number } | undefined;
    const indexResult = await transaction.execute(sql`
      select count(*)::int as count
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'manual_order_notification_outbox'
        and indexname = 'manual_order_notification_outbox_event_key_unique'
    `);
    const index = indexResult.rows[0] as { count?: number } | undefined;
    return columns?.count === 5 && index?.count === 1;
  });
  return Response.json({ migration_present: result }, { headers: { "Cache-Control": "no-store" } });
}
