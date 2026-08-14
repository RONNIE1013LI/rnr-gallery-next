CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"description" text NOT NULL,
	"quantity_milli" integer NOT NULL,
	"rate_incl_gst_cents" bigint NOT NULL,
	"line_total_incl_gst_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_items_position_nonnegative" CHECK ("invoice_items"."position" >= 0),
	CONSTRAINT "invoice_items_quantity_positive" CHECK ("invoice_items"."quantity_milli" > 0),
	CONSTRAINT "invoice_items_rate_nonnegative" CHECK ("invoice_items"."rate_incl_gst_cents" >= 0),
	CONSTRAINT "invoice_items_line_total_nonnegative" CHECK ("invoice_items"."line_total_incl_gst_cents" >= 0),
	CONSTRAINT "invoice_items_description_present" CHECK (length(trim("invoice_items"."description")) > 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"invoice_date" text NOT NULL,
	"due_date" text NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"web_order_number" text DEFAULT '' NOT NULL,
	"business_name" text NOT NULL,
	"business_address" text NOT NULL,
	"business_email" text NOT NULL,
	"business_phone" text NOT NULL,
	"business_website" text NOT NULL,
	"gst_number" text NOT NULL,
	"bank_account" text NOT NULL,
	"customer_name" text NOT NULL,
	"customer_email" text DEFAULT '' NOT NULL,
	"customer_address" text DEFAULT '' NOT NULL,
	"delivery_address" text DEFAULT '' NOT NULL,
	"currency" text DEFAULT 'NZD' NOT NULL,
	"gst_rate_basis_points" integer DEFAULT 1500 NOT NULL,
	"prices_include_gst" boolean DEFAULT true NOT NULL,
	"gross_cents" bigint NOT NULL,
	"discount_cents" bigint NOT NULL,
	"subtotal_ex_gst_cents" bigint NOT NULL,
	"gst_cents" bigint NOT NULL,
	"total_incl_gst_cents" bigint NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"terms" text DEFAULT '' NOT NULL,
	"issued_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_status_valid" CHECK ("invoices"."status" in ('draft', 'issued', 'void')),
	CONSTRAINT "invoices_currency_nzd" CHECK ("invoices"."currency" = 'NZD'),
	CONSTRAINT "invoices_gst_rate_fixed" CHECK ("invoices"."gst_rate_basis_points" = 1500 and "invoices"."prices_include_gst" = true),
	CONSTRAINT "invoices_totals_nonnegative" CHECK ("invoices"."gross_cents" >= 0 and "invoices"."discount_cents" >= 0 and "invoices"."subtotal_ex_gst_cents" >= 0 and "invoices"."gst_cents" >= 0 and "invoices"."total_incl_gst_cents" >= 0),
	CONSTRAINT "invoices_totals_balance" CHECK ("invoices"."gross_cents" - "invoices"."discount_cents" = "invoices"."total_incl_gst_cents" and "invoices"."subtotal_ex_gst_cents" + "invoices"."gst_cents" = "invoices"."total_incl_gst_cents"),
	CONSTRAINT "invoices_lifecycle_valid" CHECK (("invoices"."status" = 'draft' and "invoices"."issued_at" is null and "invoices"."voided_at" is null and "invoices"."void_reason" is null)
        or ("invoices"."status" = 'issued' and "invoices"."issued_at" is not null and "invoices"."voided_at" is null and "invoices"."void_reason" is null)
        or ("invoices"."status" = 'void' and "invoices"."issued_at" is not null and "invoices"."voided_at" is not null and length(trim("invoices"."void_reason")) > 0)),
	CONSTRAINT "invoices_dates_valid" CHECK ("invoices"."invoice_date" ~ '^\d{4}-\d{2}-\d{2}$' and "invoices"."due_date" ~ '^\d{4}-\d{2}-\d{2}$' and "invoices"."due_date" >= "invoices"."invoice_date")
);
--> statement-breakpoint
CREATE TABLE "production_field_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_key" text NOT NULL,
	"label" text NOT NULL,
	"field_type" text NOT NULL,
	"section" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"show_on_create" boolean DEFAULT false NOT NULL,
	"show_on_detail" boolean DEFAULT true NOT NULL,
	"show_on_list" boolean DEFAULT false NOT NULL,
	"legacy_only" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_field_definitions_key_valid" CHECK ("production_field_definitions"."field_key" ~ '^[a-z][a-z0-9_]{1,63}$'),
	CONSTRAINT "production_field_definitions_type_valid" CHECK ("production_field_definitions"."field_type" in ('text', 'textarea', 'number', 'date', 'select', 'radio', 'file')),
	CONSTRAINT "production_field_definitions_section_valid" CHECK ("production_field_definitions"."section" in ('order', 'product', 'payment', 'delivery', 'customer', 'design', 'production', 'finance', 'legacy')),
	CONSTRAINT "production_field_definitions_label_present" CHECK (length(trim("production_field_definitions"."label")) > 0)
);
--> statement-breakpoint
CREATE TABLE "production_field_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_field_values_length_valid" CHECK (length("production_field_values"."value") <= 10000)
);
--> statement-breakpoint
ALTER TABLE "production_jobs" DROP CONSTRAINT "production_jobs_delivery_method_valid";--> statement-breakpoint
ALTER TABLE "production_jobs" DROP CONSTRAINT "production_jobs_customer_source_valid";--> statement-breakpoint
ALTER TABLE "production_jobs" ADD COLUMN "web_order_number" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_jobs" ADD COLUMN "delivery_address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_jobs" ADD COLUMN "payment_reconciliation_status" text DEFAULT 'Not checked' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_jobs" ADD COLUMN "artist_paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "production_jobs" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_job_id_production_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."production_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_field_values" ADD CONSTRAINT "production_field_values_job_id_production_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."production_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_field_values" ADD CONSTRAINT "production_field_values_field_id_production_field_definitions_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."production_field_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_field_values" ADD CONSTRAINT "production_field_values_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_items_invoice_position_unique" ON "invoice_items" USING btree ("invoice_id","position");--> statement-breakpoint
CREATE INDEX "invoice_items_invoice_id_idx" ON "invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_job_id_unique" ON "invoices" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_invoice_number_unique" ON "invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoices_created_at_idx" ON "invoices" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "production_field_definitions_key_unique" ON "production_field_definitions" USING btree ("field_key");--> statement-breakpoint
CREATE INDEX "production_field_definitions_section_sort_idx" ON "production_field_definitions" USING btree ("section","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "production_field_values_job_field_unique" ON "production_field_values" USING btree ("job_id","field_id");--> statement-breakpoint
CREATE INDEX "production_field_values_job_id_idx" ON "production_field_values" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "production_field_values_field_id_idx" ON "production_field_values" USING btree ("field_id");--> statement-breakpoint
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_payment_reconciliation_status_valid" CHECK ("production_jobs"."payment_reconciliation_status" in ('Not checked', 'Arrive', 'Afterpay', 'ZIP PAY', 'Stripe', 'Wise', 'waitting..', 'Checked1', 'Checked2', 'Checked3', 'Checked4', 'Checked5', 'Checked6', 'Other'));--> statement-breakpoint
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_delivery_method_valid" CHECK ("production_jobs"."delivery_method" in ('post', 'pickup', 'delivery', 'email', 'courier', 'australia_shipping', 'other'));--> statement-breakpoint
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_customer_source_valid" CHECK ("production_jobs"."customer_source" in ('web', 'phone', 'messenger', 'email', 'whatsapp', 'instagram', 'tiktok', 'market', 'walk_in', 'rnr', 'wechat', 'other'));
--> statement-breakpoint
INSERT INTO "production_field_definitions" (
	"field_key", "label", "field_type", "section", "options", "required",
	"enabled", "show_on_create", "show_on_detail", "show_on_list",
	"legacy_only", "sort_order"
) VALUES
	('eteams_status', 'eTeams status', 'text', 'legacy', '[]'::jsonb, false, true, false, true, false, true, 10),
	('eteams_type', 'eTeams type', 'text', 'legacy', '[]'::jsonb, false, true, false, true, false, true, 20),
	('submitted_by_name', 'Submitted by', 'text', 'legacy', '[]'::jsonb, false, true, false, true, false, true, 30),
	('eteams_updated_at', 'eTeams updated at', 'text', 'legacy', '[]'::jsonb, false, true, false, true, false, true, 40),
	('eteams_title', 'eTeams title', 'text', 'legacy', '[]'::jsonb, false, true, false, true, false, true, 50),
	('eteams_submitted_at', 'eTeams submitted at', 'text', 'legacy', '[]'::jsonb, false, true, false, true, false, true, 60),
	('payment_proof_eteams', 'eTeams payment proof', 'file', 'legacy', '[]'::jsonb, false, true, false, true, false, true, 70)
ON CONFLICT ("field_key") DO NOTHING;
