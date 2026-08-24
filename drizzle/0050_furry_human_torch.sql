CREATE TABLE "customer_service_review_selectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"human_review_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"selector_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_review_selectors_generation_valid" CHECK ("customer_service_review_selectors"."generation" > 0),
	CONSTRAINT "customer_service_review_selectors_hash_valid" CHECK ("customer_service_review_selectors"."selector_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "customer_service_review_alert_outbox" ADD COLUMN "provider_send_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_service_review_alert_outbox" ADD COLUMN "provider_payload_digest" text;--> statement-breakpoint
ALTER TABLE "customer_service_review_alert_outbox" ADD CONSTRAINT "customer_service_review_alert_outbox_payload_digest_valid" CHECK ("customer_service_review_alert_outbox"."provider_payload_digest" is null or "customer_service_review_alert_outbox"."provider_payload_digest" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "customer_service_review_selectors" ADD CONSTRAINT "customer_service_review_selectors_human_review_id_customer_service_human_reviews_id_fk" FOREIGN KEY ("human_review_id") REFERENCES "public"."customer_service_human_reviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_review_selectors_hash_unique" ON "customer_service_review_selectors" USING btree ("selector_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_review_selectors_review_window_unique" ON "customer_service_review_selectors" USING btree ("human_review_id","generation","expires_at");--> statement-breakpoint
CREATE INDEX "customer_service_review_selectors_expiry_idx" ON "customer_service_review_selectors" USING btree ("expires_at");
