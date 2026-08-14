CREATE TABLE "production_job_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"source_order_item_id" uuid,
	"product_title" text NOT NULL,
	"size_label" text NOT NULL,
	"quantity" integer NOT NULL,
	"design_text" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_job_items_position_nonnegative" CHECK ("production_job_items"."position" >= 0),
	CONSTRAINT "production_job_items_quantity_valid" CHECK ("production_job_items"."quantity" between 1 and 100),
	CONSTRAINT "production_job_items_product_present" CHECK (length(trim("production_job_items"."product_title")) > 0),
	CONSTRAINT "production_job_items_size_present" CHECK (length(trim("production_job_items"."size_label")) > 0)
);
--> statement-breakpoint
CREATE TABLE "production_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_number" text NOT NULL,
	"source" text NOT NULL,
	"order_id" uuid,
	"idempotency_key" text,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_phone" text NOT NULL,
	"customer_source" text NOT NULL,
	"manual_status" text,
	"manual_payment_status" text,
	"urgent" boolean DEFAULT false NOT NULL,
	"needed_date" text NOT NULL,
	"delivery_method" text NOT NULL,
	"assigned_user_id" text,
	"design_requirements" text DEFAULT '' NOT NULL,
	"internal_notes" text DEFAULT '' NOT NULL,
	"amount_payable_cents" bigint,
	"amount_paid_cents" bigint,
	"artist_fee_cents" bigint,
	"material_cost_cents" bigint,
	"file_sent_at" timestamp with time zone,
	"downloaded_at" timestamp with time zone,
	"printed_at" timestamp with time zone,
	"customer_notified_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_jobs_source_valid" CHECK ("production_jobs"."source" in ('web', 'manual')),
	CONSTRAINT "production_jobs_source_link_valid" CHECK ((
        "production_jobs"."source" = 'web'
        and "production_jobs"."order_id" is not null
        and "production_jobs"."idempotency_key" is null
        and "production_jobs"."manual_status" is null
        and "production_jobs"."manual_payment_status" is null
        and "production_jobs"."amount_payable_cents" is null
        and "production_jobs"."amount_paid_cents" is null
        and "production_jobs"."artist_fee_cents" is null
        and "production_jobs"."material_cost_cents" is null
      ) or (
        "production_jobs"."source" = 'manual'
        and "production_jobs"."order_id" is null
        and "production_jobs"."idempotency_key" is not null
        and "production_jobs"."manual_status" is not null
        and "production_jobs"."manual_payment_status" is not null
        and "production_jobs"."amount_payable_cents" is not null
        and "production_jobs"."amount_paid_cents" is not null
        and "production_jobs"."artist_fee_cents" is not null
        and "production_jobs"."material_cost_cents" is not null
      )),
	CONSTRAINT "production_jobs_manual_status_valid" CHECK ("production_jobs"."manual_status" is null or "production_jobs"."manual_status" in ('new', 'designing', 'awaiting_customer', 'ready_to_print', 'printing', 'on_hold', 'shipped', 'completed', 'cancelled')),
	CONSTRAINT "production_jobs_manual_payment_status_valid" CHECK ("production_jobs"."manual_payment_status" is null or "production_jobs"."manual_payment_status" in ('awaiting_payment', 'processing', 'paid', 'failed', 'cancelled', 'refunded')),
	CONSTRAINT "production_jobs_delivery_method_valid" CHECK ("production_jobs"."delivery_method" in ('post', 'pickup')),
	CONSTRAINT "production_jobs_customer_source_valid" CHECK ("production_jobs"."customer_source" in ('web', 'phone', 'messenger', 'email', 'whatsapp', 'instagram', 'tiktok', 'market', 'walk_in', 'other')),
	CONSTRAINT "production_jobs_needed_date_valid" CHECK ("production_jobs"."needed_date" ~ '^\d{4}-\d{2}-\d{2}$'),
	CONSTRAINT "production_jobs_customer_present" CHECK (length(trim("production_jobs"."customer_name")) > 0 and (length(trim("production_jobs"."customer_email")) > 0 or length(trim("production_jobs"."customer_phone")) > 0)),
	CONSTRAINT "production_jobs_job_number_present" CHECK (length(trim("production_jobs"."job_number")) > 0),
	CONSTRAINT "production_jobs_money_nonnegative" CHECK (coalesce("production_jobs"."amount_payable_cents", 0) >= 0
        and coalesce("production_jobs"."amount_paid_cents", 0) >= 0
        and coalesce("production_jobs"."artist_fee_cents", 0) >= 0
        and coalesce("production_jobs"."material_cost_cents", 0) >= 0),
	CONSTRAINT "production_jobs_paid_not_over_payable" CHECK ("production_jobs"."amount_paid_cents" is null or "production_jobs"."amount_payable_cents" is null or "production_jobs"."amount_paid_cents" <= "production_jobs"."amount_payable_cents")
);
--> statement-breakpoint
ALTER TABLE "production_job_items" ADD CONSTRAINT "production_job_items_job_id_production_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."production_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_job_items" ADD CONSTRAINT "production_job_items_source_order_item_id_order_items_id_fk" FOREIGN KEY ("source_order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "production_job_items_job_position_unique" ON "production_job_items" USING btree ("job_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "production_job_items_source_order_item_unique" ON "production_job_items" USING btree ("source_order_item_id") WHERE "production_job_items"."source_order_item_id" is not null;--> statement-breakpoint
CREATE INDEX "production_job_items_job_id_idx" ON "production_job_items" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_jobs_job_number_unique" ON "production_jobs" USING btree ("job_number");--> statement-breakpoint
CREATE UNIQUE INDEX "production_jobs_order_id_unique" ON "production_jobs" USING btree ("order_id") WHERE "production_jobs"."order_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "production_jobs_idempotency_key_unique" ON "production_jobs" USING btree ("idempotency_key") WHERE "production_jobs"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "production_jobs_created_at_idx" ON "production_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "production_jobs_needed_date_idx" ON "production_jobs" USING btree ("needed_date");--> statement-breakpoint
CREATE INDEX "production_jobs_assigned_user_idx" ON "production_jobs" USING btree ("assigned_user_id");--> statement-breakpoint
CREATE INDEX "production_jobs_source_idx" ON "production_jobs" USING btree ("source");