ALTER TABLE "production_jobs" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_pin_requires_undelivered" CHECK ("pinned_at" is null or "delivered_at" is null);
