ALTER TABLE "customer_service_conversations" ADD COLUMN "customer_display_name" text;
--> statement-breakpoint
ALTER TABLE "customer_service_conversations" ADD COLUMN "profile_resolution_status" text DEFAULT 'unresolved' NOT NULL;
--> statement-breakpoint
ALTER TABLE "customer_service_conversations" ADD COLUMN "profile_resolved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "customer_service_conversations" ADD COLUMN "profile_retry_after" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "customer_service_conversations" ADD CONSTRAINT "customer_service_conversations_profile_status_valid" CHECK ("customer_service_conversations"."profile_resolution_status" in ('unresolved', 'resolving', 'resolved', 'temporary_failure', 'unavailable'));
--> statement-breakpoint
ALTER TABLE "customer_service_conversations" ADD CONSTRAINT "customer_service_conversations_profile_name_valid" CHECK ("customer_service_conversations"."customer_display_name" is null or (length(trim("customer_service_conversations"."customer_display_name")) between 1 and 160));
--> statement-breakpoint
CREATE INDEX "customer_service_conversations_profile_resolution_idx" ON "customer_service_conversations" USING btree ("profile_resolution_status","profile_retry_after");
--> statement-breakpoint
CREATE TRIGGER customer_service_conversations_profile_ui_change AFTER UPDATE OF customer_display_name, profile_resolution_status, profile_resolved_at, profile_retry_after ON customer_service_conversations FOR EACH ROW EXECUTE FUNCTION customer_service_mark_ui_row_change('queue_conversation', 'id');
