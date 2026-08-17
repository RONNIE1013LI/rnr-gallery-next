ALTER TABLE "customer_service_image_analysis_attempts" ADD COLUMN "reserved_cost_microusd" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_service_image_analysis_attempts" ADD COLUMN "budget_daily_scope_key" text;--> statement-breakpoint
ALTER TABLE "customer_service_image_analysis_inputs" ADD COLUMN "external_attachment_key_hash" text;--> statement-breakpoint
UPDATE "customer_service_image_analysis_inputs" AS "input"
SET "external_attachment_key_hash" = "attachment"."external_attachment_key_hash"
FROM "customer_service_attachments" AS "attachment"
WHERE "attachment"."id" = "input"."attachment_id"
  AND "attachment"."conversation_id" = "input"."conversation_id";--> statement-breakpoint
ALTER TABLE "customer_service_image_analysis_inputs" ALTER COLUMN "external_attachment_key_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_service_image_analysis_inputs" ADD COLUMN "cleanup_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_service_image_analysis_inputs" ADD COLUMN "verified_mime_type" text;--> statement-breakpoint
ALTER TABLE "customer_service_image_analysis_inputs" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "customer_service_image_analysis_inputs" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "customer_service_image_analysis_inputs" ADD COLUMN "byte_size" integer;--> statement-breakpoint
ALTER TABLE "customer_service_image_analysis_inputs" ADD COLUMN "sha256" text;--> statement-breakpoint
ALTER TABLE "customer_service_image_analysis_inputs" ADD COLUMN "private_storage_key" text;--> statement-breakpoint
ALTER TABLE "customer_service_image_analysis_inputs" ADD COLUMN "private_storage_key_hash" text;--> statement-breakpoint
ALTER TABLE "customer_service_image_analysis_inputs" ADD COLUMN "failure_code" text;--> statement-breakpoint
ALTER TABLE "customer_service_image_analysis_inputs" ADD COLUMN "delete_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_service_image_analysis_inputs" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "customer_service_image_analysis_inputs_cleanup_due_idx" ON "customer_service_image_analysis_inputs" USING btree ("cleanup_status","delete_due_at");--> statement-breakpoint
ALTER TABLE "customer_service_image_analysis_attempts" ADD CONSTRAINT "customer_service_image_analysis_attempts_reservation_valid" CHECK ("customer_service_image_analysis_attempts"."reserved_cost_microusd" >= 0 and ("customer_service_image_analysis_attempts"."reserved_cost_microusd" = 0 or length(trim("customer_service_image_analysis_attempts"."budget_daily_scope_key")) > 0));--> statement-breakpoint
ALTER TABLE "customer_service_image_analysis_inputs" ADD CONSTRAINT "customer_service_image_analysis_inputs_external_hash_valid" CHECK (length(trim("customer_service_image_analysis_inputs"."external_attachment_key_hash")) > 0);--> statement-breakpoint
ALTER TABLE "customer_service_image_analysis_inputs" ADD CONSTRAINT "customer_service_image_analysis_inputs_cleanup_status_valid" CHECK ("customer_service_image_analysis_inputs"."cleanup_status" in ('pending', 'stored', 'deleted', 'failed'));--> statement-breakpoint
ALTER TABLE "customer_service_image_analysis_inputs" ADD CONSTRAINT "customer_service_image_analysis_inputs_mime_valid" CHECK ("customer_service_image_analysis_inputs"."verified_mime_type" is null or "customer_service_image_analysis_inputs"."verified_mime_type" in ('image/jpeg', 'image/png', 'image/webp'));--> statement-breakpoint
ALTER TABLE "customer_service_image_analysis_inputs" ADD CONSTRAINT "customer_service_image_analysis_inputs_dimensions_valid" CHECK (coalesce("customer_service_image_analysis_inputs"."width", 0) >= 0 and coalesce("customer_service_image_analysis_inputs"."height", 0) >= 0 and coalesce("customer_service_image_analysis_inputs"."byte_size", 0) >= 0);
