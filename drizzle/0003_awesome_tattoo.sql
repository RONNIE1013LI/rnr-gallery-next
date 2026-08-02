ALTER TABLE "orders" DROP CONSTRAINT "orders_idempotency_key_unique";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_shipping_selection_valid";--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_provider" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_service_code" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_service_name" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_provider_reference" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_is_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_request_digest" text;--> statement-breakpoint
UPDATE "orders" SET
  "shipping_service_code" = 'pickup',
  "shipping_service_name" = 'Pickup'
WHERE "delivery_method" = 'pickup';--> statement-breakpoint
UPDATE "orders" AS "order_snapshot" SET
  "shipping_provider" = "quote"."provider",
  "shipping_service_code" = "quote"."service_code",
  "shipping_service_name" = "quote"."service_name",
  "shipping_provider_reference" = "quote"."provider_reference",
  "shipping_is_test" = "quote"."is_test",
  "shipping_request_digest" = "quote"."request_digest"
FROM "shipping_quotes" AS "quote"
WHERE "order_snapshot"."shipping_quote_id" = "quote"."id";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "shipping_service_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "shipping_service_name" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_session_idempotency_unique" ON "orders" USING btree ("checkout_session_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shipping_selection_valid" CHECK ((
        "orders"."delivery_method" = 'pickup'
        AND "orders"."shipping_quote_id" IS NULL
        AND "orders"."shipping_provider" IS NULL
        AND "orders"."shipping_service_code" = 'pickup'
        AND "orders"."shipping_service_name" = 'Pickup'
        AND "orders"."shipping_provider_reference" IS NULL
        AND "orders"."shipping_is_test" = false
        AND "orders"."shipping_request_digest" IS NULL
        AND "orders"."shipping_ex_gst_cents" = 0
        AND "orders"."shipping_gst_cents" = 0
        AND "orders"."shipping_total_incl_gst_cents" = 0
      ) OR (
        "orders"."delivery_method" = 'post'
        AND "orders"."shipping_quote_id" IS NOT NULL
        AND "orders"."shipping_provider" IS NOT NULL
        AND length("orders"."shipping_service_code") > 0
        AND length("orders"."shipping_service_name") > 0
        AND "orders"."shipping_provider_reference" IS NOT NULL
        AND "orders"."shipping_request_digest" IS NOT NULL
        AND "orders"."shipping_total_incl_gst_cents" > 0
      ));
