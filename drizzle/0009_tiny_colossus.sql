CREATE TABLE "admin_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_email" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"before_summary" jsonb,
	"after_summary" jsonb,
	"request_source" text,
	"result" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_audit_actor_email_present" CHECK (length(trim("admin_audit_logs"."actor_email")) > 0),
	CONSTRAINT "admin_audit_action_present" CHECK (length(trim("admin_audit_logs"."action")) > 0),
	CONSTRAINT "admin_audit_resource_type_present" CHECK (length(trim("admin_audit_logs"."resource_type")) > 0),
	CONSTRAINT "admin_audit_result_valid" CHECK ("admin_audit_logs"."result" in ('success', 'failure'))
);
--> statement-breakpoint
CREATE TABLE "content_entries" (
	"key" text PRIMARY KEY NOT NULL,
	"group_name" text NOT NULL,
	"label" text NOT NULL,
	"draft_value" text NOT NULL,
	"published_value" text,
	"draft_updated_by" text,
	"published_by" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_entries_key_present" CHECK (length(trim("content_entries"."key")) > 0),
	CONSTRAINT "content_entries_group_present" CHECK (length(trim("content_entries"."group_name")) > 0),
	CONSTRAINT "content_entries_label_present" CHECK (length(trim("content_entries"."label")) > 0),
	CONSTRAINT "content_entries_publish_pair_valid" CHECK (("content_entries"."published_value" is null and "content_entries"."published_at" is null and "content_entries"."published_by" is null) or ("content_entries"."published_value" is not null and "content_entries"."published_at" is not null and "content_entries"."published_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "order_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"author_user_id" text,
	"visibility" text NOT NULL,
	"body" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_notes_visibility_valid" CHECK ("order_notes"."visibility" in ('internal', 'customer')),
	CONSTRAINT "order_notes_body_present" CHECK (length(trim("order_notes"."body")) > 0)
);
--> statement-breakpoint
CREATE TABLE "order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"actor_user_id" text,
	"reason" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_status_history_changes_status" CHECK ("order_status_history"."from_status" <> "order_status_history"."to_status")
);
--> statement-breakpoint
ALTER TABLE "user" DROP CONSTRAINT "user_role_valid";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tracking_number" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tracking_carrier" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tracking_url" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_entries" ADD CONSTRAINT "content_entries_draft_updated_by_user_id_fk" FOREIGN KEY ("draft_updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_entries" ADD CONSTRAINT "content_entries_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_audit_actor_action_idempotency_unique" ON "admin_audit_logs" USING btree ("actor_user_id","action","idempotency_key");--> statement-breakpoint
CREATE INDEX "admin_audit_created_at_idx" ON "admin_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_resource_idx" ON "admin_audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "content_entries_group_idx" ON "content_entries" USING btree ("group_name");--> statement-breakpoint
CREATE UNIQUE INDEX "order_notes_order_idempotency_unique" ON "order_notes" USING btree ("order_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "order_notes_order_created_idx" ON "order_notes" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_status_history_order_idempotency_unique" ON "order_status_history" USING btree ("order_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "order_status_history_order_created_idx" ON "order_status_history" USING btree ("order_id","created_at");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_role_valid" CHECK ("user"."role" in ('customer', 'staff', 'admin'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_fulfilment_status_valid" CHECK ("orders"."fulfilment_status" in ('new', 'designing', 'awaiting_customer', 'ready_to_print', 'printing', 'on_hold', 'shipped', 'completed', 'cancelled'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tracking_pair_valid" CHECK (("orders"."tracking_number" is null and "orders"."tracking_carrier" is null and "orders"."tracking_url" is null) or ("orders"."tracking_number" is not null and "orders"."tracking_carrier" is not null));