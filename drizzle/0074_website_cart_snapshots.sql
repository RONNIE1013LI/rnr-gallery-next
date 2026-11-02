CREATE TABLE "website_analytics_cart_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stage" varchar(16) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"total_incl_gst_cents" bigint NOT NULL,
	"items" jsonb NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	CONSTRAINT "website_analytics_cart_snapshots_fingerprint_valid" CHECK ("website_analytics_cart_snapshots"."fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "website_analytics_cart_snapshots_currency_valid" CHECK ("website_analytics_cart_snapshots"."currency" in ('NZD','AUD')),
	CONSTRAINT "website_analytics_cart_snapshots_stage_valid" CHECK ("website_analytics_cart_snapshots"."stage" in ('cart','checkout')),
	CONSTRAINT "website_analytics_cart_snapshots_total_nonnegative" CHECK ("website_analytics_cart_snapshots"."total_incl_gst_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "website_analytics_cart_snapshots" ADD CONSTRAINT "website_analytics_cart_snapshots_session_id_website_analytics_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."website_analytics_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "website_analytics_cart_snapshots_session_time_idx" ON "website_analytics_cart_snapshots" USING btree ("session_id","occurred_at");

--> statement-breakpoint
CREATE INDEX "website_analytics_cart_snapshots_time_idx" ON "website_analytics_cart_snapshots" USING btree ("occurred_at");
