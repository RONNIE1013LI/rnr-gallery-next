ALTER TABLE "website_analytics_pageviews" ADD COLUMN "user_id" text;
--> statement-breakpoint
ALTER TABLE "website_analytics_cart_snapshots" ADD COLUMN "user_id" text;
--> statement-breakpoint
ALTER TABLE "website_analytics_pageviews" ADD CONSTRAINT "website_analytics_pageviews_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "website_analytics_cart_snapshots" ADD CONSTRAINT "website_analytics_cart_snapshots_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "website_analytics_pageviews_user_time_idx" ON "website_analytics_pageviews" USING btree ("user_id","occurred_at","id");
--> statement-breakpoint
CREATE INDEX "website_analytics_cart_snapshots_user_time_idx" ON "website_analytics_cart_snapshots" USING btree ("user_id","occurred_at","id");
