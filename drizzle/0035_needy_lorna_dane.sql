CREATE TABLE "payment_request_notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"kind" text NOT NULL,
	"payment_request_id" uuid NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"provider_message_id" text,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_request_notification_outbox_kind_valid" CHECK ("payment_request_notification_outbox"."kind" in ('payment_request_confirmed', 'admin_payment_request_received')),
	CONSTRAINT "payment_request_notification_outbox_status_valid" CHECK ("payment_request_notification_outbox"."status" in ('pending', 'sending', 'sent', 'failed')),
	CONSTRAINT "payment_request_notification_outbox_attempts_nonnegative" CHECK ("payment_request_notification_outbox"."attempts" >= 0),
	CONSTRAINT "payment_request_notification_outbox_recipient_present" CHECK (length(trim("payment_request_notification_outbox"."recipient_email")) > 0)
);
--> statement-breakpoint
ALTER TABLE "payment_request_notification_outbox" ADD CONSTRAINT "payment_request_notification_outbox_payment_request_id_payment_requests_id_fk" FOREIGN KEY ("payment_request_id") REFERENCES "public"."payment_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_request_notification_outbox_event_key_unique" ON "payment_request_notification_outbox" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "payment_request_notification_outbox_status_available_idx" ON "payment_request_notification_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "payment_request_notification_outbox_request_id_idx" ON "payment_request_notification_outbox" USING btree ("payment_request_id");