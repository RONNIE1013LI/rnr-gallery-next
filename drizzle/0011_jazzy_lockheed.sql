ALTER TABLE "production_jobs" DROP CONSTRAINT "production_jobs_source_link_valid";--> statement-breakpoint
ALTER TABLE "production_jobs" ADD COLUMN "request_digest" text;--> statement-breakpoint
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_source_link_valid" CHECK ((
        "production_jobs"."source" = 'web'
        and "production_jobs"."order_id" is not null
        and "production_jobs"."idempotency_key" is null
        and "production_jobs"."request_digest" is null
        and "production_jobs"."manual_status" is null
        and "production_jobs"."manual_payment_status" is null
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
      ));