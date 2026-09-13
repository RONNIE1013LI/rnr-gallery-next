import { sql } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { assertTrustedMutationRequest } from "@/server/http/mutation-request";

export const runtime = "nodejs";

const migrationStatements = [
  sql`CREATE TABLE IF NOT EXISTS "manual_order_notification_outbox" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "event_key" text NOT NULL,
    "job_id" uuid NOT NULL,
    "recipient_email" text,
    "status" text DEFAULT 'pending' NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "available_at" timestamp with time zone DEFAULT now() NOT NULL,
    "last_attempt_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "provider_message_id" text,
    "last_error_code" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "manual_order_notification_outbox_status_valid" CHECK ("status" in ('pending', 'sending', 'sent', 'failed', 'skipped')),
    CONSTRAINT "manual_order_notification_outbox_attempts_nonnegative" CHECK ("attempts" >= 0)
  )`,
  sql`DO $$ BEGIN
    ALTER TABLE "manual_order_notification_outbox" ADD CONSTRAINT "manual_order_notification_outbox_job_id_production_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."production_jobs"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  sql`CREATE UNIQUE INDEX IF NOT EXISTS "manual_order_notification_outbox_event_key_unique" ON "manual_order_notification_outbox" USING btree ("event_key")`,
  sql`CREATE INDEX IF NOT EXISTS "manual_order_notification_outbox_status_available_idx" ON "manual_order_notification_outbox" USING btree ("status", "available_at")`,
  sql`CREATE INDEX IF NOT EXISTS "manual_order_notification_outbox_job_id_idx" ON "manual_order_notification_outbox" USING btree ("job_id")`,
] as const;

export async function POST(request: Request) {
  await requireAdminPermission("manage_roles");
  assertTrustedMutationRequest(request);
  const database = getDatabase();
  const result = await database.transaction(async (transaction) => {
    const identityResult = await transaction.execute(sql`select current_database() as database`);
    const identity = identityResult.rows[0] as { database?: string } | undefined;
    if (identity?.database !== "neondb") {
      throw new Error("Unexpected database");
    }
    const existingResult = await transaction.execute(
      sql`select to_regclass('public.manual_order_notification_outbox') as table_name`,
    );
    const existing = existingResult.rows[0] as { table_name?: string } | undefined;
    if (existing?.table_name === "manual_order_notification_outbox") {
      return "already_applied" as const;
    }
    for (const statement of migrationStatements) await transaction.execute(statement);
    const verifiedResult = await transaction.execute(sql`select to_regclass('public.manual_order_notification_outbox') as table_name`);
    const verified = verifiedResult.rows[0] as { table_name?: string } | undefined;
    if (verified?.table_name !== "manual_order_notification_outbox") {
      throw new Error("Migration verification failed");
    }
    return "applied" as const;
  });
  return Response.json({ result }, { headers: { "Cache-Control": "no-store" } });
}
