-- Supplies-only migration exception: eight additive tables; store remains OFF.
-- Existing Custom products, orders, payments and migration history are unchanged.
CREATE TABLE "supplies_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"before_summary" jsonb,
	"after_summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplies_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"visible" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplies_categories_slug_valid" CHECK ("supplies_categories"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "supplies_categories_name_present" CHECK (length(trim("supplies_categories"."name")) > 0),
	CONSTRAINT "supplies_categories_sort_order_valid" CHECK ("supplies_categories"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "supplies_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"category_id" uuid,
	"storage_key" text NOT NULL,
	"alt_text" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_length" integer NOT NULL,
	"content_hash" text NOT NULL,
	"mime_type" text DEFAULT 'image/webp' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_cover" boolean DEFAULT false NOT NULL,
	"detached_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplies_images_owner_valid" CHECK (("supplies_images"."detached_at" is null and (("supplies_images"."product_id" is not null and "supplies_images"."category_id" is null) or ("supplies_images"."product_id" is null and "supplies_images"."category_id" is not null))) or ("supplies_images"."detached_at" is not null and "supplies_images"."product_id" is null and "supplies_images"."category_id" is null and not "supplies_images"."is_cover")),
	CONSTRAINT "supplies_images_dimensions_valid" CHECK ("supplies_images"."width" > 0 and "supplies_images"."height" > 0 and "supplies_images"."byte_length" > 0),
	CONSTRAINT "supplies_images_type_valid" CHECK ("supplies_images"."mime_type" = 'image/webp'),
	CONSTRAINT "supplies_images_storage_valid" CHECK ("supplies_images"."storage_key" ~ '^supplies/[a-f0-9-]+/[a-f0-9-]+[.]webp$')
);
--> statement-breakpoint
CREATE TABLE "supplies_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"sku" text NOT NULL,
	"short_description" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"price_cents" integer NOT NULL,
	"sale_price_cents" integer,
	"weight_grams" integer,
	"packed_length_mm" integer,
	"packed_width_mm" integer,
	"packed_height_mm" integer,
	"track_inventory" boolean DEFAULT false NOT NULL,
	"stock_quantity" integer,
	"available" boolean DEFAULT false NOT NULL,
	"pickup_allowed" boolean DEFAULT true NOT NULL,
	"shipping_allowed" boolean DEFAULT false NOT NULL,
	"seo_title" text DEFAULT '' NOT NULL,
	"seo_description" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplies_products_slug_valid" CHECK ("supplies_products"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "supplies_products_status_valid" CHECK ("supplies_products"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "supplies_products_price_valid" CHECK ("supplies_products"."price_cents" between 0 and 100000000 and ("supplies_products"."sale_price_cents" is null or ("supplies_products"."sale_price_cents" > 0 and "supplies_products"."sale_price_cents" < "supplies_products"."price_cents"))),
	CONSTRAINT "supplies_products_inventory_valid" CHECK (("supplies_products"."stock_quantity" is null or "supplies_products"."stock_quantity" >= 0) and (not "supplies_products"."track_inventory" or "supplies_products"."stock_quantity" is not null)),
	CONSTRAINT "supplies_products_packaging_valid" CHECK (("supplies_products"."weight_grams" is null or "supplies_products"."weight_grams" > 0) and ("supplies_products"."packed_length_mm" is null or "supplies_products"."packed_length_mm" > 0) and ("supplies_products"."packed_width_mm" is null or "supplies_products"."packed_width_mm" > 0) and ("supplies_products"."packed_height_mm" is null or "supplies_products"."packed_height_mm" > 0)),
	CONSTRAINT "supplies_products_title_sku_present" CHECK (length(trim("supplies_products"."title")) > 0 and length(trim("supplies_products"."sku")) > 0)
);
--> statement-breakpoint
CREATE TABLE "supplies_settings" (
	"key" text PRIMARY KEY DEFAULT 'primary' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"market" text DEFAULT 'NZ' NOT NULL,
	"currency" text DEFAULT 'NZD' NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplies_settings_singleton" CHECK ("supplies_settings"."key" = 'primary'),
	CONSTRAINT "supplies_settings_nz_only" CHECK ("supplies_settings"."market" = 'NZ' and "supplies_settings"."currency" = 'NZD')
);
--> statement-breakpoint
CREATE TABLE "supplies_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"label" text NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"price_cents" integer NOT NULL,
	"sale_price_cents" integer,
	"active" boolean DEFAULT true NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"weight_grams" integer,
	"packed_length_mm" integer,
	"packed_width_mm" integer,
	"packed_height_mm" integer,
	"track_inventory" boolean DEFAULT false NOT NULL,
	"stock_quantity" integer,
	"available" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplies_variants_price_valid" CHECK ("supplies_variants"."price_cents" between 0 and 100000000 and ("supplies_variants"."sale_price_cents" is null or ("supplies_variants"."sale_price_cents" > 0 and "supplies_variants"."sale_price_cents" < "supplies_variants"."price_cents"))),
	CONSTRAINT "supplies_variants_inventory_valid" CHECK (("supplies_variants"."stock_quantity" is null or "supplies_variants"."stock_quantity" >= 0) and (not "supplies_variants"."track_inventory" or "supplies_variants"."stock_quantity" is not null)),
	CONSTRAINT "supplies_variants_options_object" CHECK (jsonb_typeof("supplies_variants"."options") = 'object'),
	CONSTRAINT "supplies_variants_packaging_valid" CHECK (("supplies_variants"."weight_grams" is null or "supplies_variants"."weight_grams" > 0) and ("supplies_variants"."packed_length_mm" is null or "supplies_variants"."packed_length_mm" > 0) and ("supplies_variants"."packed_width_mm" is null or "supplies_variants"."packed_width_mm" > 0) and ("supplies_variants"."packed_height_mm" is null or "supplies_variants"."packed_height_mm" > 0))
);
--> statement-breakpoint
CREATE TABLE "supplies_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"client_item_id" uuid NOT NULL,
	"product_key" text NOT NULL,
	"product_slug" text NOT NULL,
	"product_title" text NOT NULL,
	"size_key" text NOT NULL,
	"size_label" text NOT NULL,
	"supply_snapshot" jsonb NOT NULL,
	"quantity" integer NOT NULL,
	"price_lines" jsonb NOT NULL,
	"unit_subtotal_ex_gst_cents" bigint NOT NULL,
	"unit_gst_cents" bigint NOT NULL,
	"unit_total_incl_gst_cents" bigint NOT NULL,
	"line_subtotal_ex_gst_cents" bigint NOT NULL,
	"line_gst_cents" bigint NOT NULL,
	"line_total_incl_gst_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplies_order_item_quantity_valid" CHECK ("supplies_order_items"."quantity" between 1 and 999),
	CONSTRAINT "supplies_order_item_unit_balance" CHECK ("supplies_order_items"."unit_subtotal_ex_gst_cents" >= 0 and "supplies_order_items"."unit_gst_cents" >= 0 and "supplies_order_items"."unit_total_incl_gst_cents" = "supplies_order_items"."unit_subtotal_ex_gst_cents" + "supplies_order_items"."unit_gst_cents"),
	CONSTRAINT "supplies_order_item_line_balance" CHECK ("supplies_order_items"."line_subtotal_ex_gst_cents" = "supplies_order_items"."unit_subtotal_ex_gst_cents" * "supplies_order_items"."quantity" and "supplies_order_items"."line_gst_cents" = "supplies_order_items"."unit_gst_cents" * "supplies_order_items"."quantity" and "supplies_order_items"."line_total_incl_gst_cents" = "supplies_order_items"."unit_total_incl_gst_cents" * "supplies_order_items"."quantity")
);
--> statement-breakpoint
CREATE TABLE "supplies_stock_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"selection_key" text NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"quantity" integer NOT NULL,
	"tracked" boolean NOT NULL,
	"status" text NOT NULL,
	"stock_shortage" boolean DEFAULT false NOT NULL,
	"reserved_for_payment_attempt_id" uuid,
	"expires_at" timestamp with time zone DEFAULT now() + interval '30 minutes' NOT NULL,
	"expired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplies_reservation_quantity_positive" CHECK ("supplies_stock_reservations"."quantity" > 0),
	CONSTRAINT "supplies_reservation_status_valid" CHECK ("supplies_stock_reservations"."status" in ('reserved', 'consumed', 'released', 'restocked'))
);
--> statement-breakpoint
ALTER TABLE "supplies_images" ADD CONSTRAINT "supplies_images_product_id_supplies_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."supplies_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplies_images" ADD CONSTRAINT "supplies_images_category_id_supplies_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."supplies_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplies_products" ADD CONSTRAINT "supplies_products_category_id_supplies_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."supplies_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplies_settings" ADD CONSTRAINT "supplies_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplies_variants" ADD CONSTRAINT "supplies_variants_product_id_supplies_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."supplies_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplies_order_items" ADD CONSTRAINT "supplies_order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplies_stock_reservations" ADD CONSTRAINT "supplies_stock_reservations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplies_stock_reservations" ADD CONSTRAINT "supplies_stock_reservations_product_id_supplies_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."supplies_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplies_stock_reservations" ADD CONSTRAINT "supplies_stock_reservations_variant_id_supplies_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."supplies_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplies_stock_reservations" ADD CONSTRAINT "supplies_stock_reservations_reserved_for_payment_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("reserved_for_payment_attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplies_audit_resource_idx" ON "supplies_audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "supplies_audit_created_idx" ON "supplies_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "supplies_categories_slug_unique" ON "supplies_categories" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "supplies_images_storage_unique" ON "supplies_images" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "supplies_images_product_cover_unique" ON "supplies_images" USING btree ("product_id") WHERE "supplies_images"."is_cover" and "supplies_images"."detached_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "supplies_images_category_unique" ON "supplies_images" USING btree ("category_id") WHERE "supplies_images"."detached_at" is null;--> statement-breakpoint
CREATE INDEX "supplies_images_product_idx" ON "supplies_images" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplies_products_slug_unique" ON "supplies_products" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "supplies_products_sku_unique" ON "supplies_products" USING btree (lower("sku"));--> statement-breakpoint
CREATE INDEX "supplies_products_category_status_idx" ON "supplies_products" USING btree ("category_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "supplies_variants_sku_unique" ON "supplies_variants" USING btree (lower("sku"));--> statement-breakpoint
CREATE INDEX "supplies_variants_product_idx" ON "supplies_variants" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplies_order_item_order_position_unique" ON "supplies_order_items" USING btree ("order_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "supplies_order_item_order_client_unique" ON "supplies_order_items" USING btree ("order_id","client_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplies_reservation_order_selection_unique" ON "supplies_stock_reservations" USING btree ("order_id","selection_key");--> statement-breakpoint
CREATE INDEX "supplies_reservation_product_idx" ON "supplies_stock_reservations" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "supplies_reservation_expiry_idx" ON "supplies_stock_reservations" USING btree ("expires_at","order_id") WHERE "supplies_stock_reservations"."status" = 'reserved';
--> statement-breakpoint
INSERT INTO public.supplies_settings (key, enabled, market, currency)
VALUES ('primary', false, 'NZ', 'NZD');
--> statement-breakpoint
INSERT INTO public.supplies_categories (name, slug, sort_order, visible)
VALUES
  ('Blank Canvas & Canvas Rolls', 'blank-canvas-canvas-rolls', 0, false),
  ('Roll-Up Banner Stands Only', 'roll-up-banner-stands-only', 1, false),
  ('Canvas Stretcher Bars & Frames', 'canvas-stretcher-bars-frames', 2, false);
--> statement-breakpoint
-- Override any migration-owner default table grants only for the new tables.
-- Historical snapshots and audit records are append-only to the application role.
DO $rnr_supplies$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rnr_app_runtime') THEN
    REVOKE ALL PRIVILEGES ON TABLE
      public.supplies_audit_logs, public.supplies_categories, public.supplies_images,
      public.supplies_order_items, public.supplies_products, public.supplies_settings,
      public.supplies_stock_reservations, public.supplies_variants
    FROM rnr_app_runtime;
    GRANT SELECT, INSERT, UPDATE ON TABLE
      public.supplies_categories, public.supplies_images, public.supplies_products,
      public.supplies_settings, public.supplies_stock_reservations, public.supplies_variants
    TO rnr_app_runtime;
    GRANT SELECT, INSERT ON TABLE public.supplies_audit_logs, public.supplies_order_items TO rnr_app_runtime;
    REVOKE UPDATE, DELETE ON TABLE public.supplies_audit_logs, public.supplies_order_items FROM rnr_app_runtime;
    REVOKE DELETE ON TABLE public.supplies_categories, public.supplies_images, public.supplies_products,
      public.supplies_settings, public.supplies_stock_reservations, public.supplies_variants FROM rnr_app_runtime;
  END IF;
END
$rnr_supplies$;
