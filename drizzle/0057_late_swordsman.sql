CREATE TABLE "analytics_conversion_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"transaction_id" text NOT NULL,
	"job_id" uuid NOT NULL,
	"event_type" text DEFAULT 'purchase' NOT NULL,
	"event_occurred_at" timestamp with time zone NOT NULL,
	"event_source" text NOT NULL,
	"currency" text NOT NULL,
	"value_minor" bigint NOT NULL,
	"consent_snapshot" jsonb NOT NULL,
	"attribution_snapshot" jsonb NOT NULL,
	"user_data_snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"request_id" text,
	"attempt_count" bigint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_category" text,
	"last_error_at" timestamp with time zone,
	"provider_diagnostics" jsonb,
	"accepted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"dead_lettered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_conversion_deliveries_platform_valid" CHECK ("analytics_conversion_deliveries"."platform" in ('google', 'meta')),
	CONSTRAINT "analytics_conversion_deliveries_transaction_id_valid" CHECK ("analytics_conversion_deliveries"."transaction_id" ~ '^manual-order:[0-9a-f-]{36}$'),
	CONSTRAINT "analytics_conversion_deliveries_event_type_valid" CHECK ("analytics_conversion_deliveries"."event_type" = 'purchase'),
	CONSTRAINT "analytics_conversion_deliveries_event_source_valid" CHECK ("analytics_conversion_deliveries"."event_source" in ('WEB', 'MESSAGE', 'PHONE', 'OTHER')),
	CONSTRAINT "analytics_conversion_deliveries_currency_valid" CHECK ("analytics_conversion_deliveries"."currency" in ('NZD', 'AUD')),
	CONSTRAINT "analytics_conversion_deliveries_value_positive" CHECK ("analytics_conversion_deliveries"."value_minor" > 0),
	CONSTRAINT "analytics_conversion_deliveries_status_valid" CHECK ("analytics_conversion_deliveries"."status" in ('pending', 'sending', 'accepted', 'processing', 'succeeded', 'retryable_failed', 'permanent_failed', 'dead_letter')),
	CONSTRAINT "analytics_conversion_deliveries_attempt_count_nonnegative" CHECK ("analytics_conversion_deliveries"."attempt_count" >= 0),
	CONSTRAINT "analytics_conversion_deliveries_snapshots_objects" CHECK (jsonb_typeof("analytics_conversion_deliveries"."consent_snapshot") = 'object'
        and jsonb_typeof("analytics_conversion_deliveries"."attribution_snapshot") = 'object'
        and jsonb_typeof("analytics_conversion_deliveries"."user_data_snapshot") = 'object'),
	CONSTRAINT "analytics_conversion_deliveries_lease_shape_valid" CHECK (("analytics_conversion_deliveries"."status" = 'sending' and "analytics_conversion_deliveries"."lease_token" is not null and "analytics_conversion_deliveries"."lease_expires_at" is not null)
        or ("analytics_conversion_deliveries"."status" <> 'sending' and "analytics_conversion_deliveries"."lease_token" is null and "analytics_conversion_deliveries"."lease_expires_at" is null)),
	CONSTRAINT "analytics_conversion_deliveries_request_state_valid" CHECK ("analytics_conversion_deliveries"."platform" = 'meta'
        or "analytics_conversion_deliveries"."status" not in ('accepted', 'processing', 'succeeded')
        or "analytics_conversion_deliveries"."request_id" is not null),
	CONSTRAINT "analytics_conversion_deliveries_error_category_valid" CHECK ("analytics_conversion_deliveries"."last_error_category" is null or "analytics_conversion_deliveries"."last_error_category" in ('transport', 'rate_limit', 'provider_server', 'authentication', 'permission', 'configuration', 'invalid_event', 'partial_success', 'observation_timeout')),
	CONSTRAINT "analytics_conversion_deliveries_diagnostics_object" CHECK ("analytics_conversion_deliveries"."provider_diagnostics" is null or jsonb_typeof("analytics_conversion_deliveries"."provider_diagnostics") = 'object')
);
--> statement-breakpoint
ALTER TABLE "production_jobs" DROP CONSTRAINT "production_jobs_source_link_valid";--> statement-breakpoint
ALTER TABLE "production_jobs" ADD COLUMN "manual_payment_confirmed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_conversion_deliveries_platform_transaction_unique" ON "analytics_conversion_deliveries" USING btree ("platform","transaction_id");--> statement-breakpoint
CREATE INDEX "analytics_conversion_deliveries_status_next_attempt_idx" ON "analytics_conversion_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "analytics_conversion_deliveries_job_idx" ON "analytics_conversion_deliveries" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "analytics_conversion_deliveries_request_idx" ON "analytics_conversion_deliveries" USING btree ("request_id") WHERE "analytics_conversion_deliveries"."request_id" is not null;--> statement-breakpoint
CREATE INDEX "analytics_conversion_deliveries_stale_lease_idx" ON "analytics_conversion_deliveries" USING btree ("status","lease_expires_at") WHERE "analytics_conversion_deliveries"."status" = 'sending';--> statement-breakpoint
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_source_link_valid" CHECK ((
        "production_jobs"."source" = 'web'
        and "production_jobs"."order_id" is not null
        and "production_jobs"."idempotency_key" is null
        and "production_jobs"."request_digest" is null
        and "production_jobs"."manual_status" is null
        and "production_jobs"."manual_payment_status" is null
        and "production_jobs"."manual_payment_confirmed_at" is null
        and "production_jobs"."amount_payable_cents" is null
        and "production_jobs"."amount_paid_cents" is null
        and "production_jobs"."artist_fee_cents" is null
        and "production_jobs"."material_cost_cents" is null
      ) or (
        "production_jobs"."source" = 'manual'
        and "production_jobs"."order_id" is null
        and "production_jobs"."idempotency_key" is not null
        and "production_jobs"."request_digest" is not null
        and "production_jobs"."manual_status" is not null
        and "production_jobs"."manual_payment_status" is not null
        and "production_jobs"."amount_payable_cents" is not null
        and "production_jobs"."amount_paid_cents" is not null
        and "production_jobs"."artist_fee_cents" is not null
        and "production_jobs"."material_cost_cents" is not null
      ));--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_analytics_conversion_delivery_identity_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    OLD.platform,
    OLD.transaction_id,
    OLD.job_id,
    OLD.event_type,
    OLD.event_occurred_at,
    OLD.event_source,
    OLD.currency,
    OLD.value_minor,
    OLD.created_at
  ) IS DISTINCT FROM ROW(
    NEW.platform,
    NEW.transaction_id,
    NEW.job_id,
    NEW.event_type,
    NEW.event_occurred_at,
    NEW.event_source,
    NEW.currency,
    NEW.value_minor,
    NEW.created_at
  ) THEN
    RAISE EXCEPTION 'analytics conversion delivery identity is immutable';
  END IF;

  IF ROW(OLD.consent_snapshot, OLD.attribution_snapshot, OLD.user_data_snapshot)
      IS DISTINCT FROM
      ROW(NEW.consent_snapshot, NEW.attribution_snapshot, NEW.user_data_snapshot)
  THEN
    IF NOT (
      NEW.consent_snapshot = '{"version":1,"redacted":true}'::jsonb
      AND NEW.attribution_snapshot = '{"version":1,"redacted":true}'::jsonb
      AND NEW.user_data_snapshot = '{"version":1,"redacted":true}'::jsonb
      AND COALESCE((OLD.consent_snapshot ->> 'redacted')::boolean, false) = false
      AND COALESCE((OLD.attribution_snapshot ->> 'redacted')::boolean, false) = false
      AND COALESCE((OLD.user_data_snapshot ->> 'redacted')::boolean, false) = false
    ) THEN
      RAISE EXCEPTION 'analytics conversion delivery snapshots are immutable';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER analytics_conversion_deliveries_immutable_trigger
BEFORE UPDATE ON "analytics_conversion_deliveries"
FOR EACH ROW
EXECUTE FUNCTION prevent_analytics_conversion_delivery_identity_update();--> statement-breakpoint
INSERT INTO "production_field_definitions" (
  "id", "field_key", "label", "field_type", "section", "options",
  "required", "enabled", "show_on_create", "show_on_detail", "show_on_list",
  "legacy_only", "sort_order"
)
VALUES
  ('a0d00000-0000-4000-8000-000000000001', 'advertising_consent', 'Advertising consent', 'select', 'finance', '["granted","denied"]'::jsonb, false, true, false, false, false, false, 900),
  ('a0d00000-0000-4000-8000-000000000002', 'advertising_consent_recorded_at', 'Advertising consent recorded at', 'text', 'finance', '[]'::jsonb, false, true, false, false, false, false, 901),
  ('a0d00000-0000-4000-8000-000000000003', 'advertising_source', 'Advertising source', 'text', 'finance', '[]'::jsonb, false, true, false, false, false, false, 902),
  ('a0d00000-0000-4000-8000-000000000004', 'gclid', 'Google click ID', 'text', 'finance', '[]'::jsonb, false, true, false, false, false, false, 903),
  ('a0d00000-0000-4000-8000-000000000005', 'gbraid', 'Google GBRAID', 'text', 'finance', '[]'::jsonb, false, true, false, false, false, false, 904),
  ('a0d00000-0000-4000-8000-000000000006', 'wbraid', 'Google WBRAID', 'text', 'finance', '[]'::jsonb, false, true, false, false, false, false, 905),
  ('a0d00000-0000-4000-8000-000000000007', 'fbclid', 'Meta click ID', 'text', 'finance', '[]'::jsonb, false, true, false, false, false, false, 906),
  ('a0d00000-0000-4000-8000-000000000008', 'fbp', 'Meta browser ID', 'text', 'finance', '[]'::jsonb, false, true, false, false, false, false, 907),
  ('a0d00000-0000-4000-8000-000000000009', 'fbc', 'Meta click cookie', 'text', 'finance', '[]'::jsonb, false, true, false, false, false, false, 908)
ON CONFLICT ("field_key") DO NOTHING;
