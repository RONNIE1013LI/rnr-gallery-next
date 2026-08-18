ALTER TABLE "payment_ledger_entries" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
UPDATE "payment_requests"
SET "idempotency_key" = 'legacy:' || "id"::text
WHERE "idempotency_key" IS NULL;--> statement-breakpoint
ALTER TABLE "payment_requests" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_ledger_entries_creator_idempotency_unique" ON "payment_ledger_entries" USING btree ("created_by","idempotency_key") WHERE "payment_ledger_entries"."created_by" IS NOT NULL AND "payment_ledger_entries"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_creator_idempotency_unique" ON "payment_requests" USING btree ("created_by","idempotency_key");
