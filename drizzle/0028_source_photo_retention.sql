ALTER TABLE "checkout_uploads" DROP CONSTRAINT "checkout_uploads_cleanup_unclaimed";--> statement-breakpoint
ALTER TABLE "checkout_uploads" DROP CONSTRAINT "checkout_uploads_size_bytes_positive";--> statement-breakpoint
ALTER TABLE "checkout_uploads" ALTER COLUMN "storage_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "checkout_uploads" ALTER COLUMN "original_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "checkout_uploads" ALTER COLUMN "media_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "checkout_uploads" ALTER COLUMN "size_bytes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "checkout_uploads" ALTER COLUMN "sha256" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "checkout_uploads" ADD COLUMN "purged_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "checkout_uploads_retention_idx" ON "checkout_uploads" USING btree ("purged_at","created_at");--> statement-breakpoint
ALTER TABLE "checkout_uploads" ADD CONSTRAINT "checkout_uploads_retention_consistent" CHECK ((
        "checkout_uploads"."purged_at" IS NULL
        AND "checkout_uploads"."storage_key" IS NOT NULL
        AND "checkout_uploads"."original_name" IS NOT NULL
        AND "checkout_uploads"."media_type" IS NOT NULL
        AND "checkout_uploads"."size_bytes" IS NOT NULL
        AND "checkout_uploads"."sha256" IS NOT NULL
      ) OR (
        "checkout_uploads"."purged_at" IS NOT NULL
        AND "checkout_uploads"."claimed_by_order_item_id" IS NOT NULL
        AND "checkout_uploads"."storage_key" IS NULL
        AND "checkout_uploads"."original_name" IS NULL
        AND "checkout_uploads"."media_type" IS NULL
        AND "checkout_uploads"."size_bytes" IS NULL
        AND "checkout_uploads"."sha256" IS NULL
        AND "checkout_uploads"."cleanup_claimed_at" IS NULL
      ));--> statement-breakpoint
ALTER TABLE "checkout_uploads" ADD CONSTRAINT "checkout_uploads_size_bytes_positive" CHECK ("checkout_uploads"."size_bytes" IS NULL OR "checkout_uploads"."size_bytes" > 0);