ALTER TABLE "payment_attempts" DROP CONSTRAINT "payment_attempts_provider_valid";--> statement-breakpoint
ALTER TABLE "payment_attempts" DROP CONSTRAINT "payment_attempts_method_valid";--> statement-breakpoint
ALTER TABLE "payment_attempts" DROP CONSTRAINT "payment_attempts_provider_method_valid";--> statement-breakpoint
ALTER TABLE "payment_requests" DROP CONSTRAINT "payment_requests_methods_valid";--> statement-breakpoint
ALTER TABLE "webhook_events" DROP CONSTRAINT "webhook_events_provider_valid";--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_provider_valid" CHECK ("payment_attempts"."provider" in ('stripe', 'afterpay', 'local-test'));--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_method_valid" CHECK ("payment_attempts"."method" in ('card', 'afterpay'));--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_provider_method_valid" CHECK ((
        "payment_attempts"."provider" NOT in ('stripe', 'afterpay', 'local-test')
        OR "payment_attempts"."method" NOT in ('card', 'afterpay')
        OR ("payment_attempts"."provider" = 'stripe' AND "payment_attempts"."method" = 'card')
        OR ("payment_attempts"."provider" = 'afterpay' AND "payment_attempts"."method" = 'afterpay')
        OR ("payment_attempts"."provider" = 'local-test' AND "payment_attempts"."method" in ('card', 'afterpay'))
      ));--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_methods_valid" CHECK (jsonb_typeof("payment_requests"."enabled_payment_methods") = 'array'
        AND jsonb_array_length("payment_requests"."enabled_payment_methods") > 0
        AND "payment_requests"."enabled_payment_methods" <@ '["card", "afterpay"]'::jsonb);--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_provider_valid" CHECK ("webhook_events"."provider" in ('stripe', 'afterpay', 'local-test'));