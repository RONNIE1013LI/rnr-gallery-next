import { sql } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const token = process.env.MANUAL_SHIPPING_MIGRATE_TOKEN;
  if (!token || request.headers.get("x-manual-shipping-migrate-token") !== token) {
    return Response.json({ result: "failed" }, { status: 404 });
  }
  const result = await getDatabase().transaction(async (tx) => {
    const identity = await tx.execute(sql`select current_database() as database`);
    if ((identity.rows[0] as { database?: string } | undefined)?.database !== "neondb") throw new Error("Unexpected database");
    const exists = await tx.execute(sql`select to_regclass('public.manual_order_notification_outbox') as table_name`);
    if ((exists.rows[0] as { table_name?: string } | undefined)?.table_name === "manual_order_notification_outbox") return "already_applied" as const;
    await tx.execute(sql`CREATE TABLE IF NOT EXISTS "manual_order_notification_outbox" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "event_key" text NOT NULL, "job_id" uuid NOT NULL, "recipient_email" text, "status" text DEFAULT 'pending' NOT NULL, "attempts" integer DEFAULT 0 NOT NULL, "available_at" timestamp with time zone DEFAULT now() NOT NULL, "last_attempt_at" timestamp with time zone, "sent_at" timestamp with time zone, "provider_message_id" text, "last_error_code" text, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, CONSTRAINT "manual_order_notification_outbox_status_valid" CHECK ("status" in ('pending', 'sending', 'sent', 'failed', 'skipped')), CONSTRAINT "manual_order_notification_outbox_attempts_nonnegative" CHECK ("attempts" >= 0))`);
    await tx.execute(sql`DO $$ BEGIN ALTER TABLE "manual_order_notification_outbox" ADD CONSTRAINT "manual_order_notification_outbox_job_id_production_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."production_jobs"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await tx.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "manual_order_notification_outbox_event_key_unique" ON "manual_order_notification_outbox" USING btree ("event_key")`);
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS "manual_order_notification_outbox_status_available_idx" ON "manual_order_notification_outbox" USING btree ("status", "available_at")`);
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS "manual_order_notification_outbox_job_id_idx" ON "manual_order_notification_outbox" USING btree ("job_id")`);
    return "applied" as const;
  });
  return Response.json({ result });
}
