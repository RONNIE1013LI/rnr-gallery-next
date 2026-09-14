import { sql } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const expected = process.env.MANUAL_SHIPPING_VERIFY_TOKEN;
  if (!expected || request.headers.get("x-manual-shipping-verify-token") !== expected) {
    return Response.json({ migration_present: false }, { status: 401 });
  }
  const present = await getDatabase().transaction(async (tx) => {
    const t = await tx.execute(sql`select to_regclass('public.manual_order_notification_outbox') as table_name`);
    if ((t.rows[0] as { table_name?: string } | undefined)?.table_name !== "manual_order_notification_outbox") return false;
    const c = await tx.execute(sql`select count(*)::int as count from information_schema.columns where table_schema='public' and table_name='manual_order_notification_outbox' and column_name in ('event_key','job_id','recipient_email','status','attempts')`);
    const i = await tx.execute(sql`select count(*)::int as count from pg_indexes where schemaname='public' and tablename='manual_order_notification_outbox' and indexname='manual_order_notification_outbox_event_key_unique'`);
    return (c.rows[0] as { count?: number } | undefined)?.count === 5 && (i.rows[0] as { count?: number } | undefined)?.count === 1;
  });
  return Response.json({ migration_present: present }, { headers: { "Cache-Control": "no-store" } });
}
