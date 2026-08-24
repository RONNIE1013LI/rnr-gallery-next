CREATE TABLE "customer_service_retention_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"reference_hash" text NOT NULL,
	"expires_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_retention_holds_reason_valid" CHECK ("customer_service_retention_holds"."reason" in ('order', 'dispute', 'legal')),
	CONSTRAINT "customer_service_retention_holds_reference_valid" CHECK ("customer_service_retention_holds"."reference_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "customer_service_retention_holds_release_valid" CHECK ("customer_service_retention_holds"."released_at" is null or "customer_service_retention_holds"."released_at" >= "customer_service_retention_holds"."created_at")
);
--> statement-breakpoint
CREATE TABLE "customer_service_website_metric_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"event_key_hash" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_website_metric_events_type_valid" CHECK ("customer_service_website_metric_events"."event_type" = 'rate_block'),
	CONSTRAINT "customer_service_website_metric_events_hash_valid" CHECK ("customer_service_website_metric_events"."event_key_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "customer_service_website_metric_events_expiry_valid" CHECK ("customer_service_website_metric_events"."expires_at" > "customer_service_website_metric_events"."occurred_at" and "customer_service_website_metric_events"."expires_at" <= "customer_service_website_metric_events"."occurred_at" + interval '24 hours')
);
--> statement-breakpoint
ALTER TABLE "customer_service_conversations" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_service_retention_holds" ADD CONSTRAINT "customer_service_retention_holds_conversation_id_customer_service_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."customer_service_conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_retention_holds_reference_unique" ON "customer_service_retention_holds" USING btree ("conversation_id","reason","reference_hash");--> statement-breakpoint
CREATE INDEX "customer_service_retention_holds_active_idx" ON "customer_service_retention_holds" USING btree ("conversation_id","released_at","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_website_metric_events_key_unique" ON "customer_service_website_metric_events" USING btree ("event_type","event_key_hash");--> statement-breakpoint
CREATE INDEX "customer_service_website_metric_events_expiry_idx" ON "customer_service_website_metric_events" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "customer_service_conversations_retention_idx" ON "customer_service_conversations" USING btree ("channel","anonymized_at","created_at");