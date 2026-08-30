ALTER TABLE "website_analytics_sessions"
  ADD COLUMN "is_internal" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "website_analytics_conversions"
  ADD COLUMN "is_internal" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "website_analytics_daily_aggregates"
  ADD COLUMN "internal_visitors" bigint DEFAULT 0 NOT NULL,
  ADD COLUMN "internal_sessions" bigint DEFAULT 0 NOT NULL,
  ADD COLUMN "internal_page_views" bigint DEFAULT 0 NOT NULL,
  ADD COLUMN "internal_inquiries" bigint DEFAULT 0 NOT NULL,
  ADD COLUMN "internal_orders" bigint DEFAULT 0 NOT NULL,
  ADD COLUMN "internal_paid_orders" bigint DEFAULT 0 NOT NULL,
  ADD COLUMN "internal_ordered_revenue_cents" bigint DEFAULT 0 NOT NULL,
  ADD COLUMN "internal_collected_revenue_cents" bigint DEFAULT 0 NOT NULL,
  ADD COLUMN "internal_refunded_revenue_cents" bigint DEFAULT 0 NOT NULL,
  ADD COLUMN "internal_net_collected_revenue_cents" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "website_analytics_daily_aggregates"
  ADD CONSTRAINT "website_analytics_daily_internal_metrics_valid" CHECK (
    "internal_visitors" between 0 and "visitors"
    and "internal_sessions" between 0 and "sessions"
    and "internal_page_views" between 0 and "page_views"
    and "internal_inquiries" between 0 and "inquiries"
    and "internal_orders" between 0 and "orders"
    and "internal_paid_orders" between 0 and "paid_orders"
    and "internal_ordered_revenue_cents" between 0 and "ordered_revenue_cents"
    and "internal_collected_revenue_cents" between 0 and "collected_revenue_cents"
    and "internal_refunded_revenue_cents" between 0 and "refunded_revenue_cents"
    and "internal_net_collected_revenue_cents"
      = "internal_collected_revenue_cents" - "internal_refunded_revenue_cents"
  );
--> statement-breakpoint
CREATE INDEX "website_analytics_sessions_internal_local_date_idx"
  ON "website_analytics_sessions" USING btree ("is_internal", "local_date");
--> statement-breakpoint
CREATE INDEX "website_analytics_conversions_internal_local_date_idx"
  ON "website_analytics_conversions" USING btree ("is_internal", "local_date");
