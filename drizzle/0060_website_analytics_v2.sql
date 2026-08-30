CREATE TABLE "website_analytics_attribution_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversion_id" uuid NOT NULL,
	"session_id" uuid,
	"attribution_model" text NOT NULL,
	"channel" text NOT NULL,
	"source" text NOT NULL,
	"medium" text,
	"campaign" text,
	"term" text,
	"content" text,
	"landing_path" varchar(512),
	"external_referrer_origin" text,
	"market" text,
	"country_code" varchar(2),
	"device_category" text,
	"consent_qualified_click_ids" jsonb,
	"visitor_reference" varchar(64),
	"conversion_reference" text,
	"attributed_at" timestamp with time zone NOT NULL,
	"rules_version" text DEFAULT 'v2' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "website_analytics_attribution_model_valid" CHECK ("website_analytics_attribution_snapshots"."attribution_model" in ('first_touch', 'last_touch')),
	CONSTRAINT "website_analytics_attribution_channel_valid" CHECK ("website_analytics_attribution_snapshots"."channel" in ('google_ads', 'meta_ads', 'google_organic', 'direct', 'other', 'unattributed', 'manual')),
	CONSTRAINT "website_analytics_attribution_landing_path_valid" CHECK ("website_analytics_attribution_snapshots"."landing_path" is null or ("website_analytics_attribution_snapshots"."landing_path" ~ '^/' and "website_analytics_attribution_snapshots"."landing_path" !~ '[?#]')),
	CONSTRAINT "website_analytics_attribution_market_valid" CHECK ("website_analytics_attribution_snapshots"."market" is null or "website_analytics_attribution_snapshots"."market" in ('NZ', 'AU')),
	CONSTRAINT "website_analytics_attribution_country_valid" CHECK ("website_analytics_attribution_snapshots"."country_code" is null or "website_analytics_attribution_snapshots"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "website_analytics_attribution_device_valid" CHECK ("website_analytics_attribution_snapshots"."device_category" is null or "website_analytics_attribution_snapshots"."device_category" in ('desktop', 'mobile', 'tablet', 'other')),
	CONSTRAINT "website_analytics_attribution_click_ids_valid" CHECK ("website_analytics_attribution_snapshots"."consent_qualified_click_ids" is null
        or (jsonb_typeof("website_analytics_attribution_snapshots"."consent_qualified_click_ids") = 'object'
          and "website_analytics_attribution_snapshots"."consent_qualified_click_ids" - array['gclid', 'gbraid', 'wbraid', 'fbclid']::text[] = '{}'::jsonb
          and not jsonb_path_exists(
            "website_analytics_attribution_snapshots"."consent_qualified_click_ids",
            '$.* ? (@.type() != "string" || @ == "")'
          ))),
	CONSTRAINT "website_analytics_attribution_visitor_reference_valid" CHECK ("website_analytics_attribution_snapshots"."visitor_reference" is null or "website_analytics_attribution_snapshots"."visitor_reference" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "website_analytics_attribution_rules_version_valid" CHECK ("website_analytics_attribution_snapshots"."rules_version" = 'v2')
);
--> statement-breakpoint
CREATE TABLE "website_analytics_conversions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversion_type" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"order_id" uuid,
	"production_job_id" uuid,
	"conversation_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"scope" text NOT NULL,
	"market" text,
	"currency" text,
	"ordered_amount_incl_gst_cents" bigint,
	"visitor_digest" varchar(64),
	"converting_session_id" uuid,
	"first_session_id" uuid,
	"last_session_id" uuid,
	"last_non_direct_session_id" uuid,
	"historical" boolean DEFAULT false NOT NULL,
	"consent_linked" boolean DEFAULT false NOT NULL,
	"attribution_version" text DEFAULT 'v2' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "website_analytics_conversions_type_valid" CHECK ("website_analytics_conversions"."conversion_type" in ('inquiry', 'order')),
	CONSTRAINT "website_analytics_conversions_source_type_valid" CHECK ("website_analytics_conversions"."source_type" in ('order', 'production_job', 'customer_service_conversation')
        and length(trim("website_analytics_conversions"."source_id")) > 0),
	CONSTRAINT "website_analytics_conversions_scope_valid" CHECK ("website_analytics_conversions"."scope" in ('website', 'all_business')),
	CONSTRAINT "website_analytics_conversions_commercial_shape_valid" CHECK ((
        "website_analytics_conversions"."conversion_type" = 'inquiry'
        and "website_analytics_conversions"."scope" = 'website'
        and "website_analytics_conversions"."market" is null
        and "website_analytics_conversions"."currency" is null
        and "website_analytics_conversions"."ordered_amount_incl_gst_cents" is null
      ) or (
        "website_analytics_conversions"."conversion_type" = 'order'
        and "website_analytics_conversions"."market" is not null
        and "website_analytics_conversions"."currency" is not null
        and "website_analytics_conversions"."ordered_amount_incl_gst_cents" is not null
        and "website_analytics_conversions"."market" in ('NZ', 'AU')
        and (("website_analytics_conversions"."market" = 'NZ' and "website_analytics_conversions"."currency" = 'NZD')
          or ("website_analytics_conversions"."market" = 'AU' and "website_analytics_conversions"."currency" = 'AUD'))
        and "website_analytics_conversions"."ordered_amount_incl_gst_cents" > 0
      )),
	CONSTRAINT "website_analytics_conversions_source_reference_valid" CHECK ((
        "website_analytics_conversions"."source_type" = 'order'
        and "website_analytics_conversions"."conversion_type" = 'order'
        and "website_analytics_conversions"."scope" = 'website'
        and "website_analytics_conversions"."production_job_id" is null
        and "website_analytics_conversions"."conversation_id" is null
      ) or (
        "website_analytics_conversions"."source_type" = 'production_job'
        and "website_analytics_conversions"."conversion_type" = 'order'
        and "website_analytics_conversions"."scope" = 'all_business'
        and "website_analytics_conversions"."order_id" is null
        and "website_analytics_conversions"."conversation_id" is null
      ) or (
        "website_analytics_conversions"."source_type" = 'customer_service_conversation'
        and "website_analytics_conversions"."conversion_type" = 'inquiry'
        and "website_analytics_conversions"."order_id" is null
        and "website_analytics_conversions"."production_job_id" is null
      )),
	CONSTRAINT "website_analytics_conversions_visitor_digest_valid" CHECK ("website_analytics_conversions"."visitor_digest" is null or "website_analytics_conversions"."visitor_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "website_analytics_conversions_consent_links_valid" CHECK (("website_analytics_conversions"."consent_linked" and "website_analytics_conversions"."visitor_digest" is not null)
        or (not "website_analytics_conversions"."consent_linked"
          and "website_analytics_conversions"."visitor_digest" is null
          and "website_analytics_conversions"."converting_session_id" is null
          and "website_analytics_conversions"."first_session_id" is null
          and "website_analytics_conversions"."last_session_id" is null
          and "website_analytics_conversions"."last_non_direct_session_id" is null)),
	CONSTRAINT "website_analytics_conversions_attribution_version_valid" CHECK ("website_analytics_conversions"."attribution_version" = 'v2')
);
--> statement-breakpoint
CREATE TABLE "website_analytics_daily_aggregates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"local_date" date NOT NULL,
	"scope" text NOT NULL,
	"market" text NOT NULL,
	"currency" text NOT NULL,
	"channel" text NOT NULL,
	"source" text NOT NULL,
	"medium" text NOT NULL,
	"campaign" text NOT NULL,
	"attribution_model" text NOT NULL,
	"visitors" bigint DEFAULT 0 NOT NULL,
	"sessions" bigint DEFAULT 0 NOT NULL,
	"page_views" bigint DEFAULT 0 NOT NULL,
	"inquiries" bigint DEFAULT 0 NOT NULL,
	"orders" bigint DEFAULT 0 NOT NULL,
	"paid_orders" bigint DEFAULT 0 NOT NULL,
	"ordered_revenue_cents" bigint DEFAULT 0 NOT NULL,
	"collected_revenue_cents" bigint DEFAULT 0 NOT NULL,
	"refunded_revenue_cents" bigint DEFAULT 0 NOT NULL,
	"net_collected_revenue_cents" bigint DEFAULT 0 NOT NULL,
	"rules_version" text DEFAULT 'v2' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "website_analytics_daily_scope_valid" CHECK ("website_analytics_daily_aggregates"."scope" in ('website', 'all_business')),
	CONSTRAINT "website_analytics_daily_market_valid" CHECK ("website_analytics_daily_aggregates"."market" in ('NZ', 'AU', 'Unattributed')),
	CONSTRAINT "website_analytics_daily_currency_valid" CHECK ("website_analytics_daily_aggregates"."currency" in ('NZD', 'AUD', '(not set)')
        and (("website_analytics_daily_aggregates"."market" = 'NZ' and "website_analytics_daily_aggregates"."currency" = 'NZD')
          or ("website_analytics_daily_aggregates"."market" = 'AU' and "website_analytics_daily_aggregates"."currency" = 'AUD')
          or ("website_analytics_daily_aggregates"."market" = 'Unattributed' and "website_analytics_daily_aggregates"."currency" = '(not set)'))),
	CONSTRAINT "website_analytics_daily_attribution_model_valid" CHECK ("website_analytics_daily_aggregates"."attribution_model" in ('first_touch', 'last_touch')),
	CONSTRAINT "website_analytics_daily_dimensions_valid" CHECK (length(trim("website_analytics_daily_aggregates"."channel")) > 0
        and length(trim("website_analytics_daily_aggregates"."source")) > 0
        and length(trim("website_analytics_daily_aggregates"."medium")) > 0
        and length(trim("website_analytics_daily_aggregates"."campaign")) > 0),
	CONSTRAINT "website_analytics_daily_counts_nonnegative" CHECK ("website_analytics_daily_aggregates"."visitors" >= 0
        and "website_analytics_daily_aggregates"."sessions" >= 0
        and "website_analytics_daily_aggregates"."page_views" >= 0
        and "website_analytics_daily_aggregates"."inquiries" >= 0
        and "website_analytics_daily_aggregates"."orders" >= 0
        and "website_analytics_daily_aggregates"."paid_orders" >= 0),
	CONSTRAINT "website_analytics_daily_money_valid" CHECK ("website_analytics_daily_aggregates"."ordered_revenue_cents" >= 0
        and "website_analytics_daily_aggregates"."collected_revenue_cents" >= 0
        and "website_analytics_daily_aggregates"."refunded_revenue_cents" >= 0
        and "website_analytics_daily_aggregates"."net_collected_revenue_cents" = "website_analytics_daily_aggregates"."collected_revenue_cents" - "website_analytics_daily_aggregates"."refunded_revenue_cents"
        and ("website_analytics_daily_aggregates"."currency" <> '(not set)'
          or ("website_analytics_daily_aggregates"."ordered_revenue_cents" = 0
            and "website_analytics_daily_aggregates"."collected_revenue_cents" = 0
            and "website_analytics_daily_aggregates"."refunded_revenue_cents" = 0
            and "website_analytics_daily_aggregates"."net_collected_revenue_cents" = 0))),
	CONSTRAINT "website_analytics_daily_rules_version_valid" CHECK ("website_analytics_daily_aggregates"."rules_version" = 'v2')
);
--> statement-breakpoint
CREATE TABLE "website_analytics_financial_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversion_id" uuid,
	"order_id" uuid,
	"production_job_id" uuid,
	"event_type" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"historical" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "website_analytics_financial_event_type_valid" CHECK ("website_analytics_financial_events"."event_type" in ('receipt', 'refund', 'reversal')),
	CONSTRAINT "website_analytics_financial_source_type_valid" CHECK ("website_analytics_financial_events"."source_type" in ('payment_attempt', 'payment_ledger_entry', 'manual_payment_update', 'payment_provider_event')
        and length(trim("website_analytics_financial_events"."source_id")) > 0),
	CONSTRAINT "website_analytics_financial_amount_positive" CHECK ("website_analytics_financial_events"."amount_cents" > 0),
	CONSTRAINT "website_analytics_financial_currency_valid" CHECK ("website_analytics_financial_events"."currency" in ('NZD', 'AUD'))
);
--> statement-breakpoint
CREATE TABLE "website_analytics_reconciliation_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_type" text NOT NULL,
	"state_key" text NOT NULL,
	"local_date" date,
	"cursor_occurred_at" timestamp with time zone,
	"cursor_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"scanned_count" bigint DEFAULT 0 NOT NULL,
	"created_count" bigint DEFAULT 0 NOT NULL,
	"unchanged_count" bigint DEFAULT 0 NOT NULL,
	"skipped_count" bigint DEFAULT 0 NOT NULL,
	"failed_count" bigint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "website_analytics_reconciliation_state_type_valid" CHECK ("website_analytics_reconciliation_state"."state_type" in ('dirty_date', 'backfill', 'reconciliation')
        and length(trim("website_analytics_reconciliation_state"."state_key")) > 0),
	CONSTRAINT "website_analytics_reconciliation_status_valid" CHECK ("website_analytics_reconciliation_state"."status" in ('pending', 'running', 'completed', 'failed')),
	CONSTRAINT "website_analytics_reconciliation_state_shape_valid" CHECK (("website_analytics_reconciliation_state"."state_type" = 'dirty_date'
          and "website_analytics_reconciliation_state"."local_date" is not null
          and "website_analytics_reconciliation_state"."cursor_occurred_at" is null
          and "website_analytics_reconciliation_state"."cursor_id" is null)
        or ("website_analytics_reconciliation_state"."state_type" in ('backfill', 'reconciliation')
          and "website_analytics_reconciliation_state"."local_date" is null)),
	CONSTRAINT "website_analytics_reconciliation_counts_nonnegative" CHECK ("website_analytics_reconciliation_state"."scanned_count" >= 0
        and "website_analytics_reconciliation_state"."created_count" >= 0
        and "website_analytics_reconciliation_state"."unchanged_count" >= 0
        and "website_analytics_reconciliation_state"."skipped_count" >= 0
        and "website_analytics_reconciliation_state"."failed_count" >= 0),
	CONSTRAINT "website_analytics_reconciliation_completion_valid" CHECK (("website_analytics_reconciliation_state"."status" = 'pending' and "website_analytics_reconciliation_state"."started_at" is null and "website_analytics_reconciliation_state"."completed_at" is null)
        or ("website_analytics_reconciliation_state"."status" = 'running' and "website_analytics_reconciliation_state"."started_at" is not null and "website_analytics_reconciliation_state"."completed_at" is null)
        or ("website_analytics_reconciliation_state"."status" = 'completed' and "website_analytics_reconciliation_state"."started_at" is not null and "website_analytics_reconciliation_state"."completed_at" is not null)
        or ("website_analytics_reconciliation_state"."status" = 'failed' and "website_analytics_reconciliation_state"."started_at" is not null and "website_analytics_reconciliation_state"."completed_at" is null and "website_analytics_reconciliation_state"."last_error_code" is not null))
);
--> statement-breakpoint
ALTER TABLE "website_analytics_attribution_snapshots" ADD CONSTRAINT "website_analytics_attribution_snapshots_conversion_id_website_analytics_conversions_id_fk" FOREIGN KEY ("conversion_id") REFERENCES "public"."website_analytics_conversions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_analytics_attribution_snapshots" ADD CONSTRAINT "website_analytics_attribution_snapshots_session_id_website_analytics_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."website_analytics_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_analytics_conversions" ADD CONSTRAINT "website_analytics_conversions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_analytics_conversions" ADD CONSTRAINT "website_analytics_conversions_production_job_id_production_jobs_id_fk" FOREIGN KEY ("production_job_id") REFERENCES "public"."production_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_analytics_conversions" ADD CONSTRAINT "website_analytics_conversions_conversation_id_customer_service_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."customer_service_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_analytics_conversions" ADD CONSTRAINT "website_analytics_conversions_converting_session_id_website_analytics_sessions_id_fk" FOREIGN KEY ("converting_session_id") REFERENCES "public"."website_analytics_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_analytics_conversions" ADD CONSTRAINT "website_analytics_conversions_first_session_id_website_analytics_sessions_id_fk" FOREIGN KEY ("first_session_id") REFERENCES "public"."website_analytics_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_analytics_conversions" ADD CONSTRAINT "website_analytics_conversions_last_session_id_website_analytics_sessions_id_fk" FOREIGN KEY ("last_session_id") REFERENCES "public"."website_analytics_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_analytics_conversions" ADD CONSTRAINT "website_analytics_conversions_last_non_direct_session_id_website_analytics_sessions_id_fk" FOREIGN KEY ("last_non_direct_session_id") REFERENCES "public"."website_analytics_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_analytics_financial_events" ADD CONSTRAINT "website_analytics_financial_events_conversion_id_website_analytics_conversions_id_fk" FOREIGN KEY ("conversion_id") REFERENCES "public"."website_analytics_conversions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_analytics_financial_events" ADD CONSTRAINT "website_analytics_financial_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_analytics_financial_events" ADD CONSTRAINT "website_analytics_financial_events_production_job_id_production_jobs_id_fk" FOREIGN KEY ("production_job_id") REFERENCES "public"."production_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "website_analytics_attribution_conversion_model_unique" ON "website_analytics_attribution_snapshots" USING btree ("conversion_id","attribution_model");--> statement-breakpoint
CREATE INDEX "website_analytics_attribution_model_channel_idx" ON "website_analytics_attribution_snapshots" USING btree ("attribution_model","channel");--> statement-breakpoint
CREATE INDEX "website_analytics_attribution_campaign_idx" ON "website_analytics_attribution_snapshots" USING btree ("attribution_model","campaign","source");--> statement-breakpoint
CREATE UNIQUE INDEX "website_analytics_conversions_source_unique" ON "website_analytics_conversions" USING btree ("conversion_type","source_type","source_id");--> statement-breakpoint
CREATE INDEX "website_analytics_conversions_local_scope_type_idx" ON "website_analytics_conversions" USING btree ("local_date","scope","conversion_type");--> statement-breakpoint
CREATE INDEX "website_analytics_conversions_occurred_id_idx" ON "website_analytics_conversions" USING btree ("occurred_at","id");--> statement-breakpoint
CREATE INDEX "website_analytics_conversions_order_idx" ON "website_analytics_conversions" USING btree ("order_id") WHERE "website_analytics_conversions"."order_id" is not null;--> statement-breakpoint
CREATE INDEX "website_analytics_conversions_job_idx" ON "website_analytics_conversions" USING btree ("production_job_id") WHERE "website_analytics_conversions"."production_job_id" is not null;--> statement-breakpoint
CREATE INDEX "website_analytics_conversions_conversation_idx" ON "website_analytics_conversions" USING btree ("conversation_id") WHERE "website_analytics_conversions"."conversation_id" is not null;--> statement-breakpoint
CREATE INDEX "website_analytics_conversions_visitor_occurred_idx" ON "website_analytics_conversions" USING btree ("visitor_digest","occurred_at") WHERE "website_analytics_conversions"."visitor_digest" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "website_analytics_daily_dimensions_unique" ON "website_analytics_daily_aggregates" USING btree ("local_date","scope","market","currency","channel","source","medium","campaign","attribution_model","rules_version");--> statement-breakpoint
CREATE INDEX "website_analytics_daily_scope_model_date_idx" ON "website_analytics_daily_aggregates" USING btree ("scope","attribution_model","local_date");--> statement-breakpoint
CREATE INDEX "website_analytics_daily_channel_date_idx" ON "website_analytics_daily_aggregates" USING btree ("channel","local_date");--> statement-breakpoint
CREATE INDEX "website_analytics_daily_campaign_date_idx" ON "website_analytics_daily_aggregates" USING btree ("campaign","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "website_analytics_financial_source_event_unique" ON "website_analytics_financial_events" USING btree ("source_type","source_id","event_type");--> statement-breakpoint
CREATE INDEX "website_analytics_financial_local_currency_type_idx" ON "website_analytics_financial_events" USING btree ("local_date","currency","event_type");--> statement-breakpoint
CREATE INDEX "website_analytics_financial_conversion_occurred_idx" ON "website_analytics_financial_events" USING btree ("conversion_id","occurred_at");--> statement-breakpoint
CREATE INDEX "website_analytics_financial_order_idx" ON "website_analytics_financial_events" USING btree ("order_id") WHERE "website_analytics_financial_events"."order_id" is not null;--> statement-breakpoint
CREATE INDEX "website_analytics_financial_job_idx" ON "website_analytics_financial_events" USING btree ("production_job_id") WHERE "website_analytics_financial_events"."production_job_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "website_analytics_reconciliation_state_key_unique" ON "website_analytics_reconciliation_state" USING btree ("state_type","state_key");--> statement-breakpoint
CREATE INDEX "website_analytics_reconciliation_status_date_idx" ON "website_analytics_reconciliation_state" USING btree ("status","local_date");--> statement-breakpoint
CREATE INDEX "website_analytics_sessions_visitor_started_id_idx" ON "website_analytics_sessions" USING btree ("visitor_digest","started_at","id");