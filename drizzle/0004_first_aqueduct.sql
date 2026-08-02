CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"method" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider_reference" text,
	"provider_session_lease_id" uuid,
	"provider_session_lease_expires_at" timestamp with time zone,
	"return_state_digest" text,
	"return_state_consumed_at" timestamp with time zone,
	"expected_amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"country" text NOT NULL,
	"status" text NOT NULL,
	"sanitized_failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_attempts_expected_amount_positive" CHECK ("payment_attempts"."expected_amount_cents" > 0),
	CONSTRAINT "payment_attempts_provider_valid" CHECK ("payment_attempts"."provider" in ('stripe', 'afterpay', 'zip', 'local-test')),
	CONSTRAINT "payment_attempts_method_valid" CHECK ("payment_attempts"."method" in ('card', 'afterpay', 'zip')),
	CONSTRAINT "payment_attempts_provider_method_valid" CHECK ((
        "payment_attempts"."provider" NOT in ('stripe', 'afterpay', 'zip', 'local-test')
        OR "payment_attempts"."method" NOT in ('card', 'afterpay', 'zip')
        OR ("payment_attempts"."provider" = 'stripe' AND "payment_attempts"."method" = 'card')
        OR ("payment_attempts"."provider" = 'afterpay' AND "payment_attempts"."method" = 'afterpay')
        OR ("payment_attempts"."provider" = 'zip' AND "payment_attempts"."method" = 'zip')
        OR ("payment_attempts"."provider" = 'local-test' AND "payment_attempts"."method" in ('card', 'afterpay', 'zip'))
      )),
	CONSTRAINT "payment_attempts_country_valid" CHECK ("payment_attempts"."country" in ('NZ', 'AU')),
	CONSTRAINT "payment_attempts_status_valid" CHECK ("payment_attempts"."status" in ('created', 'requires_action', 'processing', 'paid', 'failed', 'cancelled')),
	CONSTRAINT "payment_attempts_lease_pair_valid" CHECK ((
        ("payment_attempts"."provider_session_lease_id" IS NULL AND "payment_attempts"."provider_session_lease_expires_at" IS NULL)
        OR ("payment_attempts"."provider_session_lease_id" IS NOT NULL AND "payment_attempts"."provider_session_lease_expires_at" IS NOT NULL)
      )),
	CONSTRAINT "payment_attempts_return_state_digest_format" CHECK ("payment_attempts"."return_state_digest" IS NULL OR "payment_attempts"."return_state_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "payment_attempts_return_state_consumption_valid" CHECK ("payment_attempts"."return_state_consumed_at" IS NULL OR "payment_attempts"."return_state_digest" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"payment_attempt_id" uuid,
	"processing_result" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_sha256_format" CHECK ("webhook_events"."payload_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "webhook_events_provider_valid" CHECK ("webhook_events"."provider" in ('stripe', 'afterpay', 'zip', 'local-test')),
	CONSTRAINT "webhook_events_processing_result_valid" CHECK ("webhook_events"."processing_result" IS NULL OR "webhook_events"."processing_result" in ('applied', 'ignored', 'failed')),
	CONSTRAINT "webhook_events_processing_pair_valid" CHECK ((
        ("webhook_events"."processing_result" IS NULL AND "webhook_events"."processed_at" IS NULL)
        OR ("webhook_events"."processing_result" IS NOT NULL AND "webhook_events"."processed_at" IS NOT NULL)
      ))
);
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_id_total_incl_gst_currency_unique" UNIQUE("id","total_incl_gst_cents","currency");--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_expected_order_amount_fk" FOREIGN KEY ("order_id","expected_amount_cents","currency") REFERENCES "public"."orders"("id","total_incl_gst_cents","currency") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_payment_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("payment_attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_attempts_order_id_idx" ON "payment_attempts" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_provider_idempotency_unique" ON "payment_attempts" USING btree ("provider","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_provider_reference_unique" ON "payment_attempts" USING btree ("provider","provider_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_one_nonterminal_unique" ON "payment_attempts" USING btree ("order_id") WHERE "payment_attempts"."status" in ('created', 'requires_action', 'processing');--> statement-breakpoint
CREATE INDEX "webhook_events_payment_attempt_id_idx" ON "webhook_events" USING btree ("payment_attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_event_unique" ON "webhook_events" USING btree ("provider","provider_event_id");
