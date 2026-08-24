CREATE TABLE "order_system_migration_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_source" text NOT NULL,
	"legacy_attachment_id" text NOT NULL,
	"legacy_order_id" text NOT NULL,
	"source_sha256" text NOT NULL,
	"source_size_bytes" bigint NOT NULL,
	"source_mime_type" text NOT NULL,
	"output_sha256" text,
	"output_size_bytes" bigint,
	"output_mime_type" text,
	"target_job_id" uuid,
	"target_file_id" uuid,
	"private_storage_key" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"safe_error_code" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_system_migration_attachments_source_valid" CHECK ("order_system_migration_attachments"."legacy_source" = 'rnrgallery-order-system'),
	CONSTRAINT "order_system_migration_attachments_state_valid" CHECK ("order_system_migration_attachments"."state" in ('pending', 'stored', 'bound', 'verified', 'failed', 'rolled_back')),
	CONSTRAINT "order_system_migration_attachments_source_sha256_valid" CHECK ("order_system_migration_attachments"."source_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "order_system_migration_attachments_source_size_nonnegative" CHECK ("order_system_migration_attachments"."source_size_bytes" >= 0),
	CONSTRAINT "order_system_migration_attachments_output_sha256_valid" CHECK ("order_system_migration_attachments"."output_sha256" is null or "order_system_migration_attachments"."output_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "order_system_migration_attachments_output_size_nonnegative" CHECK ("order_system_migration_attachments"."output_size_bytes" is null or "order_system_migration_attachments"."output_size_bytes" >= 0),
	CONSTRAINT "order_system_migration_attachments_safe_error_code_length" CHECK ("order_system_migration_attachments"."safe_error_code" is null or length("order_system_migration_attachments"."safe_error_code") <= 100)
);
--> statement-breakpoint
CREATE TABLE "order_system_migration_journal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"migration_version" text NOT NULL,
	"legacy_source" text NOT NULL,
	"legacy_order_id" text NOT NULL,
	"source_ref_no" text NOT NULL,
	"source_digest" text NOT NULL,
	"target_job_id" uuid,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"attachment_expected" integer DEFAULT 0 NOT NULL,
	"attachment_complete" integer DEFAULT 0 NOT NULL,
	"attachment_failed" integer DEFAULT 0 NOT NULL,
	"attachment_skipped" integer DEFAULT 0 NOT NULL,
	"safe_error_code" text,
	"safe_error_detail" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_system_migration_journal_source_valid" CHECK ("order_system_migration_journal"."legacy_source" = 'rnrgallery-order-system'),
	CONSTRAINT "order_system_migration_journal_state_valid" CHECK ("order_system_migration_journal"."state" in ('pending', 'importing', 'complete', 'failed', 'rolled_back')),
	CONSTRAINT "order_system_migration_journal_attempt_count_positive" CHECK ("order_system_migration_journal"."attempt_count" >= 0),
	CONSTRAINT "order_system_migration_journal_attachment_counts_nonnegative" CHECK ("order_system_migration_journal"."attachment_expected" >= 0 and "order_system_migration_journal"."attachment_complete" >= 0 and "order_system_migration_journal"."attachment_failed" >= 0 and "order_system_migration_journal"."attachment_skipped" >= 0),
	CONSTRAINT "order_system_migration_journal_source_digest_valid" CHECK ("order_system_migration_journal"."source_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "order_system_migration_journal_safe_error_code_length" CHECK ("order_system_migration_journal"."safe_error_code" is null or length("order_system_migration_journal"."safe_error_code") <= 100),
	CONSTRAINT "order_system_migration_journal_safe_error_detail_length" CHECK ("order_system_migration_journal"."safe_error_detail" is null or length("order_system_migration_journal"."safe_error_detail") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "production_jobs" DROP CONSTRAINT "production_jobs_needed_date_valid";--> statement-breakpoint
ALTER TABLE "production_jobs" DROP CONSTRAINT "production_jobs_customer_present";--> statement-breakpoint
ALTER TABLE "production_jobs" DROP CONSTRAINT "production_jobs_paid_not_over_payable";--> statement-breakpoint
ALTER TABLE "production_jobs" ADD COLUMN "legacy_source" text;--> statement-breakpoint
ALTER TABLE "production_jobs" ADD COLUMN "legacy_order_id" text;--> statement-breakpoint
ALTER TABLE "order_system_migration_attachments" ADD CONSTRAINT "order_system_migration_attachments_target_job_id_production_jobs_id_fk" FOREIGN KEY ("target_job_id") REFERENCES "public"."production_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_system_migration_attachments" ADD CONSTRAINT "order_system_migration_attachments_target_file_id_production_job_files_id_fk" FOREIGN KEY ("target_file_id") REFERENCES "public"."production_job_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_system_migration_journal" ADD CONSTRAINT "order_system_migration_journal_target_job_id_production_jobs_id_fk" FOREIGN KEY ("target_job_id") REFERENCES "public"."production_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_system_migration_attachments_legacy_identity_unique" ON "order_system_migration_attachments" USING btree ("legacy_source","legacy_attachment_id");--> statement-breakpoint
CREATE INDEX "order_system_migration_attachments_legacy_order_idx" ON "order_system_migration_attachments" USING btree ("legacy_source","legacy_order_id");--> statement-breakpoint
CREATE INDEX "order_system_migration_attachments_state_idx" ON "order_system_migration_attachments" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "order_system_migration_journal_legacy_identity_unique" ON "order_system_migration_journal" USING btree ("legacy_source","legacy_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_system_migration_journal_target_job_unique" ON "order_system_migration_journal" USING btree ("target_job_id") WHERE "order_system_migration_journal"."target_job_id" is not null;--> statement-breakpoint
CREATE INDEX "order_system_migration_journal_state_idx" ON "order_system_migration_journal" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "production_jobs_legacy_identity_unique" ON "production_jobs" USING btree ("legacy_source","legacy_order_id") WHERE "production_jobs"."legacy_source" is not null and "production_jobs"."legacy_order_id" is not null;--> statement-breakpoint
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_legacy_identity_pair" CHECK (("production_jobs"."legacy_source" is null and "production_jobs"."legacy_order_id" is null) or ("production_jobs"."legacy_source" is not null and "production_jobs"."legacy_order_id" is not null));--> statement-breakpoint
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_legacy_source_valid" CHECK ("production_jobs"."legacy_source" is null or "production_jobs"."legacy_source" in ('rnrgallery-order-system'));--> statement-breakpoint
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_needed_date_valid" CHECK (("production_jobs"."legacy_source" is not null and "production_jobs"."legacy_source" = 'rnrgallery-order-system') or "production_jobs"."needed_date" ~ '^\d{4}-\d{2}-\d{2}$');--> statement-breakpoint
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_customer_present" CHECK (length(trim("production_jobs"."customer_name")) > 0 and (length(trim("production_jobs"."customer_email")) > 0 or length(trim("production_jobs"."customer_phone")) > 0 or ("production_jobs"."legacy_source" is not null and "production_jobs"."legacy_source" = 'rnrgallery-order-system')));--> statement-breakpoint
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_paid_not_over_payable" CHECK (("production_jobs"."legacy_source" is not null and "production_jobs"."legacy_source" = 'rnrgallery-order-system') or "production_jobs"."amount_paid_cents" is null or "production_jobs"."amount_payable_cents" is null or "production_jobs"."amount_paid_cents" <= "production_jobs"."amount_payable_cents");