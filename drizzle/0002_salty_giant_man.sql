CREATE TABLE "checkout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_digest" text NOT NULL,
	"customer_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"cart_digest" text,
	"cart_snapshot" jsonb,
	"billing_address" jsonb,
	"delivery_address" jsonb,
	"delivery_method" text,
	"selected_shipping_quote_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkout_sessions_token_digest_unique" UNIQUE("token_digest"),
	CONSTRAINT "checkout_sessions_version_positive" CHECK ("checkout_sessions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "shipping_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checkout_session_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"provider" text NOT NULL,
	"service_code" text NOT NULL,
	"service_name" text NOT NULL,
	"currency" text DEFAULT 'NZD' NOT NULL,
	"amount_ex_gst_cents" bigint NOT NULL,
	"gst_cents" bigint NOT NULL,
	"amount_incl_gst_cents" bigint NOT NULL,
	"provider_reference" text NOT NULL,
	"raw_response_hash" text NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_quotes_session_id_id_unique" UNIQUE("checkout_session_id","id"),
	CONSTRAINT "shipping_quotes_amount_ex_gst_nonnegative" CHECK ("shipping_quotes"."amount_ex_gst_cents" >= 0),
	CONSTRAINT "shipping_quotes_gst_nonnegative" CHECK ("shipping_quotes"."gst_cents" >= 0),
	CONSTRAINT "shipping_quotes_amount_incl_gst_positive" CHECK ("shipping_quotes"."amount_incl_gst_cents" > 0),
	CONSTRAINT "shipping_quotes_amounts_balance" CHECK ("shipping_quotes"."amount_incl_gst_cents" = "shipping_quotes"."amount_ex_gst_cents" + "shipping_quotes"."gst_cents"),
	CONSTRAINT "shipping_quotes_currency_nzd" CHECK ("shipping_quotes"."currency" = 'NZD')
);
--> statement-breakpoint
CREATE TABLE "order_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"country" text NOT NULL,
	"full_name" text NOT NULL,
	"building" text NOT NULL,
	"street" text NOT NULL,
	"suburb" text NOT NULL,
	"region" text NOT NULL,
	"postcode" text NOT NULL,
	"phone" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_addresses_kind_valid" CHECK ("order_addresses"."kind" IN ('billing', 'delivery')),
	CONSTRAINT "order_addresses_country_valid" CHECK ("order_addresses"."country" IN ('NZ', 'AU'))
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checkout_session_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"client_item_id" uuid NOT NULL,
	"product_key" text NOT NULL,
	"product_slug" text NOT NULL,
	"product_title" text NOT NULL,
	"size_key" text NOT NULL,
	"size_label" text NOT NULL,
	"orientation" text,
	"people_pets" integer NOT NULL,
	"photo_submission_method" text NOT NULL,
	"design_text" text NOT NULL,
	"notes" text NOT NULL,
	"needed_date" text NOT NULL,
	"urgent_service_confirmed" boolean NOT NULL,
	"urgent_working_days" integer NOT NULL,
	"quantity" integer NOT NULL,
	"price_lines" jsonb NOT NULL,
	"upload_references" jsonb NOT NULL,
	"unit_subtotal_ex_gst_cents" bigint NOT NULL,
	"unit_gst_cents" bigint NOT NULL,
	"unit_total_incl_gst_cents" bigint NOT NULL,
	"line_subtotal_ex_gst_cents" bigint NOT NULL,
	"line_gst_cents" bigint NOT NULL,
	"line_total_incl_gst_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_checkout_session_id_id_unique" UNIQUE("checkout_session_id","id"),
	CONSTRAINT "order_items_position_nonnegative" CHECK ("order_items"."position" >= 0),
	CONSTRAINT "order_items_people_pets_valid" CHECK ("order_items"."people_pets" BETWEEN 0 AND 20),
	CONSTRAINT "order_items_urgent_days_positive" CHECK ("order_items"."urgent_working_days" > 0),
	CONSTRAINT "order_items_quantity_valid" CHECK ("order_items"."quantity" BETWEEN 1 AND 5),
	CONSTRAINT "order_items_unit_subtotal_nonnegative" CHECK ("order_items"."unit_subtotal_ex_gst_cents" >= 0),
	CONSTRAINT "order_items_unit_gst_nonnegative" CHECK ("order_items"."unit_gst_cents" >= 0),
	CONSTRAINT "order_items_unit_total_nonnegative" CHECK ("order_items"."unit_total_incl_gst_cents" >= 0),
	CONSTRAINT "order_items_line_subtotal_nonnegative" CHECK ("order_items"."line_subtotal_ex_gst_cents" >= 0),
	CONSTRAINT "order_items_line_gst_nonnegative" CHECK ("order_items"."line_gst_cents" >= 0),
	CONSTRAINT "order_items_line_total_nonnegative" CHECK ("order_items"."line_total_incl_gst_cents" >= 0),
	CONSTRAINT "order_items_unit_amounts_balance" CHECK ("order_items"."unit_total_incl_gst_cents" = "order_items"."unit_subtotal_ex_gst_cents" + "order_items"."unit_gst_cents"),
	CONSTRAINT "order_items_line_subtotal_matches_quantity" CHECK ("order_items"."line_subtotal_ex_gst_cents" = "order_items"."unit_subtotal_ex_gst_cents" * "order_items"."quantity"),
	CONSTRAINT "order_items_line_gst_matches_quantity" CHECK ("order_items"."line_gst_cents" = "order_items"."unit_gst_cents" * "order_items"."quantity"),
	CONSTRAINT "order_items_line_total_matches_quantity" CHECK ("order_items"."line_total_incl_gst_cents" = "order_items"."unit_total_incl_gst_cents" * "order_items"."quantity")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"checkout_session_id" uuid NOT NULL,
	"checkout_session_version" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"customer_id" text,
	"customer_email" text NOT NULL,
	"currency" text DEFAULT 'NZD' NOT NULL,
	"delivery_method" text NOT NULL,
	"shipping_quote_id" uuid,
	"product_subtotal_ex_gst_cents" bigint NOT NULL,
	"product_gst_cents" bigint NOT NULL,
	"product_total_incl_gst_cents" bigint NOT NULL,
	"shipping_ex_gst_cents" bigint NOT NULL,
	"shipping_gst_cents" bigint NOT NULL,
	"shipping_total_incl_gst_cents" bigint NOT NULL,
	"total_ex_gst_cents" bigint NOT NULL,
	"total_gst_cents" bigint NOT NULL,
	"total_incl_gst_cents" bigint NOT NULL,
	"payment_status" text DEFAULT 'awaiting_payment' NOT NULL,
	"fulfilment_status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_number_unique" UNIQUE("order_number"),
	CONSTRAINT "orders_checkout_session_id_unique" UNIQUE("checkout_session_id"),
	CONSTRAINT "orders_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "orders_checkout_session_id_id_unique" UNIQUE("checkout_session_id","id"),
	CONSTRAINT "orders_checkout_version_positive" CHECK ("orders"."checkout_session_version" > 0),
	CONSTRAINT "orders_product_subtotal_nonnegative" CHECK ("orders"."product_subtotal_ex_gst_cents" >= 0),
	CONSTRAINT "orders_product_gst_nonnegative" CHECK ("orders"."product_gst_cents" >= 0),
	CONSTRAINT "orders_product_total_nonnegative" CHECK ("orders"."product_total_incl_gst_cents" >= 0),
	CONSTRAINT "orders_shipping_ex_gst_nonnegative" CHECK ("orders"."shipping_ex_gst_cents" >= 0),
	CONSTRAINT "orders_shipping_gst_nonnegative" CHECK ("orders"."shipping_gst_cents" >= 0),
	CONSTRAINT "orders_shipping_total_nonnegative" CHECK ("orders"."shipping_total_incl_gst_cents" >= 0),
	CONSTRAINT "orders_total_ex_gst_nonnegative" CHECK ("orders"."total_ex_gst_cents" >= 0),
	CONSTRAINT "orders_total_gst_nonnegative" CHECK ("orders"."total_gst_cents" >= 0),
	CONSTRAINT "orders_total_incl_gst_nonnegative" CHECK ("orders"."total_incl_gst_cents" >= 0),
	CONSTRAINT "orders_product_amounts_balance" CHECK ("orders"."product_total_incl_gst_cents" = "orders"."product_subtotal_ex_gst_cents" + "orders"."product_gst_cents"),
	CONSTRAINT "orders_shipping_amounts_balance" CHECK ("orders"."shipping_total_incl_gst_cents" = "orders"."shipping_ex_gst_cents" + "orders"."shipping_gst_cents"),
	CONSTRAINT "orders_total_ex_gst_balance" CHECK ("orders"."total_ex_gst_cents" = "orders"."product_subtotal_ex_gst_cents" + "orders"."shipping_ex_gst_cents"),
	CONSTRAINT "orders_total_gst_balance" CHECK ("orders"."total_gst_cents" = "orders"."product_gst_cents" + "orders"."shipping_gst_cents"),
	CONSTRAINT "orders_total_incl_gst_balance" CHECK ("orders"."total_incl_gst_cents" = "orders"."total_ex_gst_cents" + "orders"."total_gst_cents"),
	CONSTRAINT "orders_currency_nzd" CHECK ("orders"."currency" = 'NZD'),
	CONSTRAINT "orders_shipping_selection_valid" CHECK (("orders"."delivery_method" = 'pickup' AND "orders"."shipping_quote_id" IS NULL AND "orders"."shipping_total_incl_gst_cents" = 0) OR ("orders"."delivery_method" = 'post' AND "orders"."shipping_quote_id" IS NOT NULL AND "orders"."shipping_total_incl_gst_cents" > 0))
);
--> statement-breakpoint
CREATE TABLE "checkout_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checkout_session_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"claimed_by_order_item_id" uuid,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkout_uploads_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "checkout_uploads_claimed_by_order_item_id_unique" UNIQUE("claimed_by_order_item_id"),
	CONSTRAINT "checkout_uploads_size_bytes_positive" CHECK ("checkout_uploads"."size_bytes" > 0),
	CONSTRAINT "checkout_uploads_claim_consistent" CHECK (("checkout_uploads"."claimed_by_order_item_id" IS NULL AND "checkout_uploads"."claimed_at" IS NULL) OR ("checkout_uploads"."claimed_by_order_item_id" IS NOT NULL AND "checkout_uploads"."claimed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_customer_id_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_selected_shipping_quote_id_shipping_quotes_id_fk" FOREIGN KEY ("selected_shipping_quote_id") REFERENCES "public"."shipping_quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_quotes" ADD CONSTRAINT "shipping_quotes_checkout_session_id_checkout_sessions_id_fk" FOREIGN KEY ("checkout_session_id") REFERENCES "public"."checkout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_addresses" ADD CONSTRAINT "order_addresses_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_owner_fk" FOREIGN KEY ("checkout_session_id","order_id") REFERENCES "public"."orders"("checkout_session_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_checkout_session_id_checkout_sessions_id_fk" FOREIGN KEY ("checkout_session_id") REFERENCES "public"."checkout_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shipping_quote_owner_fk" FOREIGN KEY ("checkout_session_id","shipping_quote_id") REFERENCES "public"."shipping_quotes"("checkout_session_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_uploads" ADD CONSTRAINT "checkout_uploads_checkout_session_id_checkout_sessions_id_fk" FOREIGN KEY ("checkout_session_id") REFERENCES "public"."checkout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_uploads" ADD CONSTRAINT "checkout_uploads_claim_owner_fk" FOREIGN KEY ("checkout_session_id","claimed_by_order_item_id") REFERENCES "public"."order_items"("checkout_session_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checkout_sessions_customer_id_idx" ON "checkout_sessions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "checkout_sessions_expires_at_idx" ON "checkout_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "shipping_quotes_checkout_session_id_idx" ON "shipping_quotes" USING btree ("checkout_session_id");--> statement-breakpoint
CREATE INDEX "shipping_quotes_expires_at_idx" ON "shipping_quotes" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shipping_quotes_provider_reference_unique" ON "shipping_quotes" USING btree ("checkout_session_id","provider","provider_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "order_addresses_order_kind_unique" ON "order_addresses" USING btree ("order_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_order_position_unique" ON "order_items" USING btree ("order_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_order_client_item_unique" ON "order_items" USING btree ("order_id","client_item_id");--> statement-breakpoint
CREATE INDEX "orders_customer_id_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_created_at_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "checkout_uploads_checkout_session_id_idx" ON "checkout_uploads" USING btree ("checkout_session_id");