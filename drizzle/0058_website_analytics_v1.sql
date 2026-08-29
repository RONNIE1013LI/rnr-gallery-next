CREATE TABLE "website_analytics_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"visitor_digest" varchar(64) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"channel" varchar(32) NOT NULL,
	"source" varchar(255),
	"medium" varchar(100),
	"utm_campaign" varchar(100),
	"click_id_type" varchar(16),
	"country_code" varchar(2),
	CONSTRAINT "website_analytics_sessions_visitor_digest_valid" CHECK ("website_analytics_sessions"."visitor_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "website_analytics_sessions_channel_valid" CHECK ("website_analytics_sessions"."channel" in ('google_ads', 'meta_ads', 'google_organic', 'direct', 'other')),
	CONSTRAINT "website_analytics_sessions_click_id_type_valid" CHECK ("website_analytics_sessions"."click_id_type" is null or "website_analytics_sessions"."click_id_type" in ('gclid', 'gbraid', 'wbraid', 'fbclid')),
	CONSTRAINT "website_analytics_sessions_country_code_valid" CHECK ("website_analytics_sessions"."country_code" is null or "website_analytics_sessions"."country_code" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "website_analytics_pageviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"pathname" varchar(512) NOT NULL,
	CONSTRAINT "website_analytics_pageviews_pathname_valid" CHECK ("website_analytics_pageviews"."pathname" ~ '^/' and "website_analytics_pageviews"."pathname" !~ '[?#]')
);
--> statement-breakpoint
ALTER TABLE "website_analytics_pageviews" ADD CONSTRAINT "website_analytics_pageviews_session_id_website_analytics_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."website_analytics_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "website_analytics_sessions_local_date_visitor_idx" ON "website_analytics_sessions" USING btree ("local_date","visitor_digest");--> statement-breakpoint
CREATE INDEX "website_analytics_sessions_local_date_channel_idx" ON "website_analytics_sessions" USING btree ("local_date","channel");--> statement-breakpoint
CREATE INDEX "website_analytics_sessions_started_id_idx" ON "website_analytics_sessions" USING btree ("started_at","id");--> statement-breakpoint
CREATE INDEX "website_analytics_pageviews_session_idx" ON "website_analytics_pageviews" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "website_analytics_pageviews_local_path_session_idx" ON "website_analytics_pageviews" USING btree ("local_date","pathname","session_id");
