CREATE TABLE "customer_notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"kind" text NOT NULL,
	"job_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"recipient_email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"provider_message_id" text,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_notification_outbox_kind_valid" CHECK ("customer_notification_outbox"."kind" in ('proof_ready', 'proof_approved', 'proof_changes_requested')),
	CONSTRAINT "customer_notification_outbox_status_valid" CHECK ("customer_notification_outbox"."status" in ('pending', 'sending', 'sent', 'failed')),
	CONSTRAINT "customer_notification_outbox_attempts_nonnegative" CHECK ("customer_notification_outbox"."attempts" >= 0),
	CONSTRAINT "customer_notification_outbox_recipient_present" CHECK (length(trim("customer_notification_outbox"."recipient_email")) > 0)
);
--> statement-breakpoint
ALTER TABLE "production_proof_reviews" ADD COLUMN "reviewer_type" text DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_notification_outbox" ADD CONSTRAINT "customer_notification_outbox_job_id_production_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."production_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notification_outbox" ADD CONSTRAINT "customer_notification_outbox_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notification_outbox" ADD CONSTRAINT "customer_notification_outbox_file_id_production_job_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."production_job_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_notification_outbox_event_key_unique" ON "customer_notification_outbox" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "customer_notification_outbox_status_available_idx" ON "customer_notification_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "customer_notification_outbox_job_id_idx" ON "customer_notification_outbox" USING btree ("job_id");--> statement-breakpoint
ALTER TABLE "production_proof_reviews" ADD CONSTRAINT "production_proof_reviews_reviewer_type_valid" CHECK ("production_proof_reviews"."reviewer_type" in ('staff', 'customer'));