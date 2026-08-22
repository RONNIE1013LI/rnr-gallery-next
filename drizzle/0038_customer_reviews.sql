CREATE TABLE "customer_review_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "customer_review_media_kind_valid" CHECK ("customer_review_media"."kind" in ('AVATAR', 'FEATURED_IMAGE', 'PERMISSION_EVIDENCE')),
	CONSTRAINT "customer_review_media_mime_type_valid" CHECK ("customer_review_media"."mime_type" in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "customer_review_media_size_positive" CHECK ("customer_review_media"."size_bytes" > 0),
	CONSTRAINT "customer_review_media_dimensions_positive" CHECK ("customer_review_media"."width" > 0 and "customer_review_media"."height" > 0),
	CONSTRAINT "customer_review_media_sha256_format" CHECK ("customer_review_media"."sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "customer_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_platform" text DEFAULT 'FACEBOOK' NOT NULL,
	"reviewer_name" text NOT NULL,
	"original_review_text" text NOT NULL,
	"source_review_url" text,
	"review_date" date NOT NULL,
	"recommendation_status" text DEFAULT 'RECOMMENDS' NOT NULL,
	"editorial_headline" text,
	"product_key" text,
	"product_display_label" text,
	"order_context" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"is_homepage_featured" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"permission_status" text DEFAULT 'PENDING' NOT NULL,
	"permission_evidence_reference" text,
	"permission_notes" text,
	"last_verified_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_reviews_source_platform_valid" CHECK ("customer_reviews"."source_platform" = 'FACEBOOK'),
	CONSTRAINT "customer_reviews_recommendation_status_valid" CHECK ("customer_reviews"."recommendation_status" in ('RECOMMENDS', 'DOES_NOT_RECOMMEND', 'LEGACY_STAR_REVIEW')),
	CONSTRAINT "customer_reviews_status_valid" CHECK ("customer_reviews"."status" in ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
	CONSTRAINT "customer_reviews_permission_status_valid" CHECK ("customer_reviews"."permission_status" in ('PENDING', 'GRANTED', 'REVOKED')),
	CONSTRAINT "customer_reviews_featured_public_valid" CHECK ("customer_reviews"."is_homepage_featured" = false or ("customer_reviews"."status" = 'PUBLISHED' and "customer_reviews"."permission_status" = 'GRANTED' and "customer_reviews"."recommendation_status" = 'RECOMMENDS')),
	CONSTRAINT "customer_reviews_display_order_nonnegative" CHECK ("customer_reviews"."display_order" >= 0),
	CONSTRAINT "customer_reviews_publication_timestamps_valid" CHECK (("customer_reviews"."status" = 'DRAFT' and "customer_reviews"."published_at" is null and "customer_reviews"."archived_at" is null) or ("customer_reviews"."status" = 'PUBLISHED' and "customer_reviews"."published_at" is not null and "customer_reviews"."archived_at" is null) or ("customer_reviews"."status" = 'ARCHIVED' and "customer_reviews"."archived_at" is not null)),
	CONSTRAINT "customer_reviews_product_pair_valid" CHECK (("customer_reviews"."product_key" is null and "customer_reviews"."product_display_label" is null) or ("customer_reviews"."product_key" is not null and "customer_reviews"."product_display_label" is not null)),
	CONSTRAINT "customer_reviews_reviewer_name_present" CHECK (length(trim("customer_reviews"."reviewer_name")) > 0),
	CONSTRAINT "customer_reviews_text_present" CHECK (length(trim("customer_reviews"."original_review_text")) > 0)
);
--> statement-breakpoint
ALTER TABLE "customer_review_media" ADD CONSTRAINT "customer_review_media_review_id_customer_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."customer_reviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_review_media" ADD CONSTRAINT "customer_review_media_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_reviews" ADD CONSTRAINT "customer_reviews_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_reviews" ADD CONSTRAINT "customer_reviews_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_review_media_review_kind_unique" ON "customer_review_media" USING btree ("review_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_review_media_storage_key_unique" ON "customer_review_media" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "customer_reviews_admin_status_idx" ON "customer_reviews" USING btree ("status","permission_status");--> statement-breakpoint
CREATE INDEX "customer_reviews_public_order_idx" ON "customer_reviews" USING btree ("status","permission_status","recommendation_status","display_order","review_date");--> statement-breakpoint
CREATE INDEX "customer_reviews_product_public_idx" ON "customer_reviews" USING btree ("product_key","status");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_reviews_one_public_featured_unique" ON "customer_reviews" USING btree ("is_homepage_featured") WHERE "customer_reviews"."is_homepage_featured" = true and "customer_reviews"."status" = 'PUBLISHED' and "customer_reviews"."permission_status" = 'GRANTED' and "customer_reviews"."recommendation_status" = 'RECOMMENDS';