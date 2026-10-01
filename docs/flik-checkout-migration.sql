-- Flik-only migration exception. Review before execution; Flik remains disabled.
-- Existing Stripe, Afterpay and payment-request rows are preserved unchanged.
ALTER TABLE "payment_attempts" DROP CONSTRAINT "payment_attempts_provider_valid";
--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_provider_valid" CHECK ("provider" in ('stripe', 'afterpay', 'local-test', 'flik'));
--> statement-breakpoint
ALTER TABLE "payment_attempts" DROP CONSTRAINT "payment_attempts_method_valid";
--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_method_valid" CHECK ("method" in ('card', 'afterpay', 'flik'));
--> statement-breakpoint
ALTER TABLE "payment_attempts" DROP CONSTRAINT "payment_attempts_provider_method_valid";
--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_provider_method_valid" CHECK (
  "provider" NOT in ('stripe', 'afterpay', 'local-test', 'flik')
  OR "method" NOT in ('card', 'afterpay', 'flik')
  OR ("provider" = 'stripe' AND "method" = 'card')
  OR ("provider" = 'afterpay' AND "method" = 'afterpay')
  OR ("provider" = 'flik' AND "method" = 'flik')
  OR ("provider" = 'local-test' AND "method" in ('card', 'afterpay'))
);
--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_flik_checkout_only" CHECK (
  "provider" <> 'flik' OR (
    "order_id" IS NOT NULL AND "payment_request_id" IS NULL
    AND "country" = 'NZ' AND "currency" = 'NZD'
  )
);
--> statement-breakpoint
CREATE TABLE "flik_checkout_sessions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "payment_attempt_id" uuid,
  "order_id" uuid,
  "merchant_reference" text NOT NULL,
  "admin_user_id" text,
  "test_mode" boolean NOT NULL,
  "market" text NOT NULL,
  "billing_country" text NOT NULL,
  "delivery_country" text NOT NULL,
  "currency" text NOT NULL,
  "expected_amount_cents" bigint NOT NULL,
  "idempotency_key" text NOT NULL,
  "return_url" text NOT NULL,
  "webhook_url" text NOT NULL,
  "hosted_url" text,
  "provider_reference" text,
  "provider_status" text DEFAULT 'created' NOT NULL,
  "applied_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "creation_lease_id" uuid,
  "creation_lease_expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "flik_checkout_sessions_target_valid" CHECK (
    ("test_mode" AND "payment_attempt_id" IS NULL AND "order_id" IS NULL
      AND "admin_user_id" IS NOT NULL AND length(trim("admin_user_id")) > 0)
    OR (NOT "test_mode" AND "payment_attempt_id" IS NOT NULL AND "order_id" IS NOT NULL
      AND "id" = "payment_attempt_id" AND "admin_user_id" IS NULL)
  ),
  CONSTRAINT "flik_checkout_sessions_nz_only" CHECK (
    "market" = 'NZ' AND "billing_country" = 'NZ' AND "delivery_country" = 'NZ' AND "currency" = 'NZD'
  ),
  CONSTRAINT "flik_checkout_sessions_amount_valid" CHECK ("expected_amount_cents" BETWEEN 1 AND 1000000),
  CONSTRAINT "flik_checkout_sessions_lease_pair" CHECK (("creation_lease_id" IS NULL) = ("creation_lease_expires_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "flik_checkout_sessions" ADD CONSTRAINT "flik_checkout_sessions_payment_attempt_id_payment_attempts_id_fk"
  FOREIGN KEY ("payment_attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "flik_checkout_sessions" ADD CONSTRAINT "flik_checkout_sessions_expected_order_amount_fk"
  FOREIGN KEY ("order_id", "expected_amount_cents", "currency")
  REFERENCES "public"."orders"("id", "total_incl_gst_cents", "currency") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "flik_checkout_sessions_attempt_unique" ON "flik_checkout_sessions" USING btree ("payment_attempt_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "flik_checkout_sessions_provider_reference_unique" ON "flik_checkout_sessions" USING btree ("provider_reference");
--> statement-breakpoint
CREATE UNIQUE INDEX "flik_checkout_sessions_idempotency_unique" ON "flik_checkout_sessions" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "flik_checkout_sessions_pending_idx" ON "flik_checkout_sessions" USING btree ("updated_at") WHERE "applied_at" IS NULL;
--> statement-breakpoint
CREATE TABLE "flik_webhook_events" (
  "transaction_id" text PRIMARY KEY NOT NULL,
  "payload_sha256" text NOT NULL,
  "checkout_session_id" text NOT NULL,
  "foreign_transaction_id" uuid NOT NULL,
  "processed_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "flik_webhook_events_sha256_valid" CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX "flik_webhook_events_pending_idx" ON "flik_webhook_events" USING btree ("updated_at") WHERE "processed_at" IS NULL;
