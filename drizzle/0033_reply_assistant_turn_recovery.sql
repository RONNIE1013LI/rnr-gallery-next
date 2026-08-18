ALTER TABLE "customer_service_turns" ADD COLUMN "processing_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_service_turns" ADD COLUMN "processing_lease_token" text;--> statement-breakpoint
ALTER TABLE "customer_service_turns" ADD COLUMN "processing_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_service_turns" ADD COLUMN "processing_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_service_turns" ADD COLUMN "next_run_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_service_turns" ADD COLUMN "last_processing_error" text;--> statement-breakpoint
ALTER TABLE "customer_service_turns" ADD COLUMN "processing_completed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "customer_service_turns"
SET "processing_status" = 'completed',
    "processing_completed_at" = coalesce("sealed_at", "updated_at", now());--> statement-breakpoint
CREATE INDEX "customer_service_turns_processing_due_idx" ON "customer_service_turns" USING btree ("processing_status","next_run_at","processing_lease_expires_at");--> statement-breakpoint
ALTER TABLE "customer_service_turns" ADD CONSTRAINT "customer_service_turns_processing_status_valid" CHECK ("customer_service_turns"."processing_status" in ('pending', 'running', 'completed', 'cancelled'));--> statement-breakpoint
ALTER TABLE "customer_service_turns" ADD CONSTRAINT "customer_service_turns_processing_attempts_valid" CHECK ("customer_service_turns"."processing_attempts" >= 0);--> statement-breakpoint
ALTER TABLE "customer_service_turns" ADD CONSTRAINT "customer_service_turns_processing_lease_valid" CHECK (("customer_service_turns"."processing_status" = 'running' and "customer_service_turns"."processing_lease_token" is not null and "customer_service_turns"."processing_lease_expires_at" is not null) or ("customer_service_turns"."processing_status" <> 'running' and "customer_service_turns"."processing_lease_token" is null and "customer_service_turns"."processing_lease_expires_at" is null));
