UPDATE "customer_service_messages"
SET "customer_text" = "body"
WHERE "customer_text" IS NULL
	AND "body" <> '[Image attachment]';
--> statement-breakpoint
CREATE TABLE "customer_service_image_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"image_analysis_attempt_id" uuid,
	"text_attempt_id" uuid,
	"stage" text DEFAULT 'policy' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"source_ciphertext" text,
	"source_expires_at" timestamp with time zone,
	"terminal_after_cleanup" boolean DEFAULT false NOT NULL,
	"failure_code" text,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reserved_cost_microusd" bigint DEFAULT 0 NOT NULL,
	"budget_daily_scope_key" text,
	"budget_settled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_image_jobs_stage_valid" CHECK ("customer_service_image_jobs"."stage" in ('policy', 'download', 'vision', 'cleanup', 'draft')),
	CONSTRAINT "customer_service_image_jobs_status_valid" CHECK ("customer_service_image_jobs"."status" in ('pending', 'running', 'completed', 'human_review_required')),
	CONSTRAINT "customer_service_image_jobs_reservation_valid" CHECK ("customer_service_image_jobs"."reserved_cost_microusd" >= 0 and ("customer_service_image_jobs"."reserved_cost_microusd" = 0 or length(trim("customer_service_image_jobs"."budget_daily_scope_key")) > 0)),
	CONSTRAINT "customer_service_image_jobs_source_pair_valid" CHECK (("customer_service_image_jobs"."source_ciphertext" is null and "customer_service_image_jobs"."source_expires_at" is null) or ("customer_service_image_jobs"."source_ciphertext" is not null and "customer_service_image_jobs"."source_expires_at" is not null)),
	CONSTRAINT "customer_service_image_jobs_lease_pair_valid" CHECK (("customer_service_image_jobs"."lease_token" is null and "customer_service_image_jobs"."lease_expires_at" is null) or ("customer_service_image_jobs"."lease_token" is not null and "customer_service_image_jobs"."lease_expires_at" is not null)),
	CONSTRAINT "customer_service_image_jobs_terminal_valid" CHECK ("customer_service_image_jobs"."status" in ('pending', 'running') or "customer_service_image_jobs"."completed_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "customer_service_image_analysis_inputs" ADD COLUMN "cleanup_claim_token" uuid;--> statement-breakpoint
ALTER TABLE "customer_service_image_analysis_inputs" ADD COLUMN "cleanup_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_service_image_jobs" ADD CONSTRAINT "customer_service_image_jobs_text_attempt_id_customer_service_ai_attempts_id_fk" FOREIGN KEY ("text_attempt_id") REFERENCES "public"."customer_service_ai_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_image_jobs" ADD CONSTRAINT "customer_service_image_jobs_message_conversation_fk" FOREIGN KEY ("message_id","conversation_id") REFERENCES "public"."customer_service_messages"("id","conversation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_image_jobs" ADD CONSTRAINT "customer_service_image_jobs_attempt_conversation_fk" FOREIGN KEY ("image_analysis_attempt_id","conversation_id") REFERENCES "public"."customer_service_image_analysis_attempts"("id","conversation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_image_jobs_message_unique" ON "customer_service_image_jobs" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "customer_service_image_jobs_claim_idx" ON "customer_service_image_jobs" USING btree ("status","next_run_at","lease_expires_at");
