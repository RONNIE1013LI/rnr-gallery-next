ALTER TABLE "production_job_files" ADD COLUMN "idempotency_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "production_job_files" ADD COLUMN "request_digest" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "production_job_files_idempotency_key_unique" ON "production_job_files" USING btree ("idempotency_key");--> statement-breakpoint
ALTER TABLE "production_job_files" ADD CONSTRAINT "production_job_files_request_digest_valid" CHECK ("production_job_files"."request_digest" ~ '^[0-9a-f]{64}$');