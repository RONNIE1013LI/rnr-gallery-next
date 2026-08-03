CREATE TABLE "gallery_design_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"design_id" char(64) NOT NULL,
	"revision_number" integer NOT NULL,
	"prior_snapshot" jsonb NOT NULL,
	"actor_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gallery_design_revisions_number_positive" CHECK ("gallery_design_revisions"."revision_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "gallery_designs" (
	"id" char(64) PRIMARY KEY NOT NULL,
	"product_type_slug" text NOT NULL,
	"occasion_slug" text NOT NULL,
	"sub_occasion" text,
	"theme_slugs" jsonb NOT NULL,
	"alt_text" text NOT NULL,
	"product_slug" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_hash" char(64) NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"trashed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gallery_designs_product_type_valid" CHECK ("gallery_designs"."product_type_slug" in ('canvas', 'grave-cover', 'roll-up-banner', 'wall-hanging-banners')),
	CONSTRAINT "gallery_designs_occasion_valid" CHECK ("gallery_designs"."occasion_slug" in ('baby-kids', 'birthday', 'business-promotion', 'family-portrait', 'general-celebration', 'graduation', 'memorial', 'personalised-artwork', 'religious', 'wedding')),
	CONSTRAINT "gallery_designs_product_slug_valid" CHECK ("gallery_designs"."product_slug" in ('digital-oil-painting-canvas', 'custom-themed-canvas', 'grave-cover', 'roll-up-banner', 'custom-themed-wall-banner')),
	CONSTRAINT "gallery_designs_mime_type_valid" CHECK ("gallery_designs"."mime_type" in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "gallery_designs_width_positive" CHECK ("gallery_designs"."width" > 0),
	CONSTRAINT "gallery_designs_height_positive" CHECK ("gallery_designs"."height" > 0),
	CONSTRAINT "gallery_designs_alt_text_present" CHECK (length(trim("gallery_designs"."alt_text")) > 0),
	CONSTRAINT "gallery_designs_content_hash_format" CHECK ("gallery_designs"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "gallery_designs_status_valid" CHECK ("gallery_designs"."status" in ('active', 'trashed')),
	CONSTRAINT "gallery_designs_trashed_at_valid" CHECK (("gallery_designs"."status" = 'active' and "gallery_designs"."trashed_at" is null) or ("gallery_designs"."status" = 'trashed' and "gallery_designs"."trashed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "gallery_design_id" char(64);--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "gallery_design_title" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "gallery_design_content_hash" char(64);--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "gallery_design_product_slug" text;--> statement-breakpoint
ALTER TABLE "gallery_design_revisions" ADD CONSTRAINT "gallery_design_revisions_design_id_gallery_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."gallery_designs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_design_revisions" ADD CONSTRAINT "gallery_design_revisions_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_design_revisions_design_revision_unique" ON "gallery_design_revisions" USING btree ("design_id","revision_number");--> statement-breakpoint
CREATE INDEX "gallery_design_revisions_design_created_idx" ON "gallery_design_revisions" USING btree ("design_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_designs_storage_key_unique" ON "gallery_designs" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "gallery_designs_active_content_hash_unique" ON "gallery_designs" USING btree ("content_hash") WHERE "gallery_designs"."status" = 'active';--> statement-breakpoint
CREATE INDEX "gallery_designs_public_filters_idx" ON "gallery_designs" USING btree ("status","product_type_slug","occasion_slug");--> statement-breakpoint
CREATE INDEX "gallery_designs_updated_at_idx" ON "gallery_designs" USING btree ("updated_at");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_gallery_snapshot_complete" CHECK ((
        "order_items"."gallery_design_id" is null
        and "order_items"."gallery_design_title" is null
        and "order_items"."gallery_design_content_hash" is null
        and "order_items"."gallery_design_product_slug" is null
      ) or (
        "order_items"."gallery_design_id" is not null
        and length(trim("order_items"."gallery_design_title")) > 0
        and "order_items"."gallery_design_content_hash" ~ '^[a-f0-9]{64}$'
        and length(trim("order_items"."gallery_design_product_slug")) > 0
      ));