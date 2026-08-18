CREATE TABLE "payment_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"payment_request_id" uuid,
	"payment_attempt_id" uuid,
	"entry_type" text NOT NULL,
	"direction" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"reference" text,
	"payer_name" text,
	"note" text,
	"reverses_entry_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_ledger_entries_target_valid" CHECK (num_nonnulls("payment_ledger_entries"."order_id", "payment_ledger_entries"."payment_request_id") >= 1),
	CONSTRAINT "payment_ledger_entries_amount_positive" CHECK ("payment_ledger_entries"."amount_cents" > 0),
	CONSTRAINT "payment_ledger_entries_currency_valid" CHECK ("payment_ledger_entries"."currency" in ('NZD', 'AUD')),
	CONSTRAINT "payment_ledger_entries_type_valid" CHECK ("payment_ledger_entries"."entry_type" in ('online_payment', 'bank_transfer', 'reversal', 'legacy_backfill', 'refund')),
	CONSTRAINT "payment_ledger_entries_direction_valid" CHECK ((
        ("payment_ledger_entries"."entry_type" in ('online_payment', 'bank_transfer', 'legacy_backfill') AND "payment_ledger_entries"."direction" = 'credit')
        OR ("payment_ledger_entries"."entry_type" in ('reversal', 'refund') AND "payment_ledger_entries"."direction" = 'debit')
      )),
	CONSTRAINT "payment_ledger_entries_reversal_link_valid" CHECK ((
        ("payment_ledger_entries"."entry_type" = 'reversal' AND "payment_ledger_entries"."reverses_entry_id" IS NOT NULL)
        OR ("payment_ledger_entries"."entry_type" <> 'reversal' AND "payment_ledger_entries"."reverses_entry_id" IS NULL)
      )),
	CONSTRAINT "payment_ledger_entries_online_attempt_valid" CHECK ((
        ("payment_ledger_entries"."entry_type" = 'online_payment' AND "payment_ledger_entries"."payment_attempt_id" IS NOT NULL)
        OR ("payment_ledger_entries"."entry_type" <> 'online_payment')
      ))
);
--> statement-breakpoint
CREATE TABLE "payment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_number" text NOT NULL,
	"public_token_digest" text NOT NULL,
	"token_rotated_at" timestamp with time zone,
	"kind" text NOT NULL,
	"order_id" uuid,
	"customer_name" text,
	"customer_email" text,
	"description" text NOT NULL,
	"currency" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"enabled_payment_methods" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"status_reason" text,
	"expires_at" timestamp with time zone,
	"internal_note" text,
	"created_by" text NOT NULL,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_requests_request_number_unique" UNIQUE("request_number"),
	CONSTRAINT "payment_requests_public_token_digest_unique" UNIQUE("public_token_digest"),
	CONSTRAINT "payment_requests_expected_amount_unique" UNIQUE("id","amount_cents","currency"),
	CONSTRAINT "payment_requests_target_matches_kind" CHECK ((
        ("payment_requests"."kind" = 'order_balance' AND "payment_requests"."order_id" IS NOT NULL)
        OR ("payment_requests"."kind" = 'standalone' AND "payment_requests"."order_id" IS NULL)
      )),
	CONSTRAINT "payment_requests_amount_positive" CHECK ("payment_requests"."amount_cents" > 0),
	CONSTRAINT "payment_requests_currency_valid" CHECK ("payment_requests"."currency" in ('NZD', 'AUD')),
	CONSTRAINT "payment_requests_status_valid" CHECK ("payment_requests"."status" in ('pending', 'paid', 'expired', 'cancelled', 'invalidated')),
	CONSTRAINT "payment_requests_token_digest_format" CHECK ("payment_requests"."public_token_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "payment_requests_methods_valid" CHECK (jsonb_typeof("payment_requests"."enabled_payment_methods") = 'array'
        AND jsonb_array_length("payment_requests"."enabled_payment_methods") > 0
        AND "payment_requests"."enabled_payment_methods" <@ '["card", "afterpay", "zip"]'::jsonb),
	CONSTRAINT "payment_requests_terminal_timestamps_valid" CHECK ((
        ("payment_requests"."status" = 'paid' AND "payment_requests"."paid_at" IS NOT NULL)
        OR ("payment_requests"."status" = 'cancelled' AND "payment_requests"."cancelled_at" IS NOT NULL)
        OR ("payment_requests"."status" = 'invalidated' AND "payment_requests"."invalidated_at" IS NOT NULL)
        OR ("payment_requests"."status" in ('pending', 'expired'))
      ))
);
--> statement-breakpoint
DROP INDEX "payment_attempts_one_nonterminal_unique";--> statement-breakpoint
ALTER TABLE "payment_attempts" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "payment_request_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "payer_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "payment_ledger_entries" ADD CONSTRAINT "payment_ledger_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_ledger_entries" ADD CONSTRAINT "payment_ledger_entries_payment_request_id_payment_requests_id_fk" FOREIGN KEY ("payment_request_id") REFERENCES "public"."payment_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_ledger_entries" ADD CONSTRAINT "payment_ledger_entries_payment_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("payment_attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_ledger_entries" ADD CONSTRAINT "payment_ledger_entries_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_ledger_entries" ADD CONSTRAINT "payment_ledger_entries_reverses_entry_fk" FOREIGN KEY ("reverses_entry_id") REFERENCES "public"."payment_ledger_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_ledger_entries_order_id_idx" ON "payment_ledger_entries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payment_ledger_entries_payment_request_id_idx" ON "payment_ledger_entries" USING btree ("payment_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_ledger_entries_payment_attempt_unique" ON "payment_ledger_entries" USING btree ("payment_attempt_id") WHERE "payment_ledger_entries"."payment_attempt_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_ledger_entries_reversal_unique" ON "payment_ledger_entries" USING btree ("reverses_entry_id") WHERE "payment_ledger_entries"."reverses_entry_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "payment_requests_order_id_idx" ON "payment_requests" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payment_requests_status_idx" ON "payment_requests" USING btree ("status");--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_expected_payment_request_amount_fk" FOREIGN KEY ("payment_request_id","expected_amount_cents","currency") REFERENCES "public"."payment_requests"("id","amount_cents","currency") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_attempts_payment_request_id_idx" ON "payment_attempts" USING btree ("payment_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_one_nonterminal_order_unique" ON "payment_attempts" USING btree ("order_id") WHERE "payment_attempts"."order_id" IS NOT NULL AND "payment_attempts"."status" in ('created', 'requires_action', 'processing');--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_one_nonterminal_request_unique" ON "payment_attempts" USING btree ("payment_request_id") WHERE "payment_attempts"."payment_request_id" IS NOT NULL AND "payment_attempts"."status" in ('created', 'requires_action', 'processing');--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_exactly_one_target" CHECK (num_nonnulls("payment_attempts"."order_id", "payment_attempts"."payment_request_id") = 1);--> statement-breakpoint
INSERT INTO "payment_ledger_entries" (
	"order_id",
	"payment_attempt_id",
	"entry_type",
	"direction",
	"amount_cents",
	"currency",
	"received_at",
	"reference"
)
SELECT
	"payment_attempts"."order_id",
	"payment_attempts"."id",
	'online_payment',
	'credit',
	"payment_attempts"."expected_amount_cents",
	"payment_attempts"."currency",
	"payment_attempts"."updated_at",
	'legacy verified payment attempt'
FROM "payment_attempts"
WHERE "payment_attempts"."status" = 'paid'
	AND "payment_attempts"."order_id" IS NOT NULL
ON CONFLICT ("payment_attempt_id") WHERE "payment_attempt_id" IS NOT NULL DO NOTHING;--> statement-breakpoint
INSERT INTO "payment_ledger_entries" (
	"order_id",
	"entry_type",
	"direction",
	"amount_cents",
	"currency",
	"received_at",
	"reference"
)
SELECT
	"orders"."id",
	'legacy_backfill',
	'credit',
	"orders"."total_incl_gst_cents",
	"orders"."currency",
	"orders"."updated_at",
	'legacy paid order backfill'
FROM "orders"
WHERE "orders"."payment_status" = 'paid'
	AND "orders"."total_incl_gst_cents" > 0
	AND NOT EXISTS (
		SELECT 1
		FROM "payment_ledger_entries"
		WHERE "payment_ledger_entries"."order_id" = "orders"."id"
			AND "payment_ledger_entries"."direction" = 'credit'
	);
