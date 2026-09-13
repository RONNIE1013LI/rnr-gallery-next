CREATE TABLE "manual_order_notification_outbox" (
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
	CONSTRAINT "manual_order_notification_outbox_status_valid" CHECK ("manual_order_notification_outbox"."status" in ('pending', 'sending', 'sent', 'failed', 'skipped')),
	CONSTRAINT "manual_order_notification_outbox_attempts_nonnegative" CHECK ("manual_order_notification_outbox"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "manual_order_notification_outbox" ADD CONSTRAINT "manual_order_notification_outbox_job_id_production_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."production_jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "manual_order_notification_outbox_event_key_unique" ON "manual_order_notification_outbox" USING btree ("event_key");
--> statement-breakpoint
CREATE INDEX "manual_order_notification_outbox_status_available_idx" ON "manual_order_notification_outbox" USING btree ("status", "available_at");
--> statement-breakpoint
CREATE INDEX "manual_order_notification_outbox_job_id_idx" ON "manual_order_notification_outbox" USING btree ("job_id");
