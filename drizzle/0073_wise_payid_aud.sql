-- PayID-only migration exception authorized 23 October 2026. Other migration work remains frozen.
-- Existing data and payment channels preserved; transaction rollback restores prior constraints on failure.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
CREATE TABLE "wise_payid_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid,
	"intent_id" uuid,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "wise_payid_intents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"profile_id" bigint NOT NULL,
	"balance_id" bigint NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'AUD' NOT NULL,
	"merchant_reference" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wise_payid_intents_reference_unique" UNIQUE("reference"),
	CONSTRAINT "wise_payid_intents_aud" CHECK ("wise_payid_intents"."currency" = 'AUD' AND "wise_payid_intents"."amount_cents" > 0),
	CONSTRAINT "wise_payid_intents_reference" CHECK ("wise_payid_intents"."reference" ~ '^RRA[0-9A-F]{16}$')
);

--> statement-breakpoint
CREATE TABLE "wise_payid_poll_state" (
	"key" text PRIMARY KEY NOT NULL,
	"last_started_at" timestamp with time zone NOT NULL,
	"successful_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL
);

--> statement-breakpoint
CREATE TABLE "wise_payid_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" bigint NOT NULL,
	"balance_id" bigint NOT NULL,
	"transaction_id" text NOT NULL,
	"digest" text NOT NULL,
	"amount_cents" bigint,
	"currency" text NOT NULL,
	"reference" text,
	"payer_name" text,
	"received_at" timestamp with time zone NOT NULL,
	"eligible" boolean NOT NULL,
	"intent_id" uuid,
	"status" text DEFAULT 'unmatched' NOT NULL,
	"reason" text,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wise_payid_receipts_status" CHECK ("wise_payid_receipts"."status" in ('unmatched','review','reserved','applied','ignored')),
	CONSTRAINT "wise_payid_receipts_binding" CHECK (("wise_payid_receipts"."status" in ('reserved','applied') AND "wise_payid_receipts"."intent_id" IS NOT NULL) OR "wise_payid_receipts"."status" = 'review' OR ("wise_payid_receipts"."status" in ('unmatched','ignored') AND "wise_payid_receipts"."intent_id" IS NULL)),
	CONSTRAINT "wise_payid_receipts_applied" CHECK (("wise_payid_receipts"."status" = 'applied') = ("wise_payid_receipts"."applied_at" IS NOT NULL))
);

--> statement-breakpoint
ALTER TABLE "payment_attempts" DROP CONSTRAINT "payment_attempts_provider_valid";
--> statement-breakpoint
ALTER TABLE "payment_attempts" DROP CONSTRAINT "payment_attempts_method_valid";
--> statement-breakpoint
ALTER TABLE "payment_attempts" DROP CONSTRAINT "payment_attempts_provider_method_valid";
--> statement-breakpoint
ALTER TABLE "wise_payid_audit" ADD CONSTRAINT "wise_payid_audit_receipt_id_wise_payid_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."wise_payid_receipts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wise_payid_audit" ADD CONSTRAINT "wise_payid_audit_intent_id_wise_payid_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."wise_payid_intents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wise_payid_intents" ADD CONSTRAINT "wise_payid_intents_id_payment_attempts_id_fk" FOREIGN KEY ("id") REFERENCES "public"."payment_attempts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wise_payid_intents" ADD CONSTRAINT "wise_payid_intents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wise_payid_receipts" ADD CONSTRAINT "wise_payid_receipts_intent_id_wise_payid_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."wise_payid_intents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "wise_payid_intents_order_idx" ON "wise_payid_intents" USING btree ("order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "wise_payid_receipts_transaction_unique" ON "wise_payid_receipts" USING btree ("profile_id","balance_id","transaction_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "wise_payid_receipts_intent_unique" ON "wise_payid_receipts" USING btree ("intent_id") WHERE "wise_payid_receipts"."intent_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "wise_payid_receipts_review_idx" ON "wise_payid_receipts" USING btree ("status","created_at");
--> statement-breakpoint
CREATE INDEX "wise_payid_receipts_reference_idx" ON "wise_payid_receipts" USING btree ("profile_id","balance_id","reference");
--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_wise_checkout_only" CHECK ("payment_attempts"."provider" <> 'wise' OR ("payment_attempts"."order_id" IS NOT NULL AND "payment_attempts"."payment_request_id" IS NULL AND "payment_attempts"."country" = 'AU' AND "payment_attempts"."currency" = 'AUD'));
--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_provider_valid" CHECK ("payment_attempts"."provider" in ('stripe', 'afterpay', 'local-test', 'flik', 'wise'));
--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_method_valid" CHECK ("payment_attempts"."method" in ('card', 'afterpay', 'flik', 'payid'));
--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_provider_method_valid" CHECK ((
        "payment_attempts"."provider" NOT in ('stripe', 'afterpay', 'local-test', 'flik', 'wise')
        OR "payment_attempts"."method" NOT in ('card', 'afterpay', 'flik', 'payid')
        OR ("payment_attempts"."provider" = 'stripe' AND "payment_attempts"."method" = 'card')
        OR ("payment_attempts"."provider" = 'afterpay' AND "payment_attempts"."method" = 'afterpay')
        OR ("payment_attempts"."provider" = 'flik' AND "payment_attempts"."method" = 'flik')
        OR ("payment_attempts"."provider" = 'wise' AND "payment_attempts"."method" = 'payid')
        OR ("payment_attempts"."provider" = 'local-test' AND "payment_attempts"."method" in ('card', 'afterpay'))
      ));
--> statement-breakpoint
-- Override owner defaults only for Wise tables. Keep evidence and audit append-only.
DO $rnr_wise$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rnr_app_runtime') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.wise_payid_audit, public.wise_payid_intents,
      public.wise_payid_receipts, public.wise_payid_poll_state FROM rnr_app_runtime;
    GRANT SELECT, INSERT ON TABLE public.wise_payid_audit, public.wise_payid_intents TO rnr_app_runtime;
    GRANT SELECT, INSERT, UPDATE ON TABLE public.wise_payid_receipts, public.wise_payid_poll_state TO rnr_app_runtime;
  END IF;
END
$rnr_wise$;
