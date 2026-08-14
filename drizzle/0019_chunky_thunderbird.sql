CREATE TABLE "order_notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"kind" text NOT NULL,
	"order_id" uuid NOT NULL,
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
	CONSTRAINT "order_notification_outbox_kind_valid" CHECK ("order_notification_outbox"."kind" in ('payment_confirmed', 'payment_failed', 'order_shipped')),
	CONSTRAINT "order_notification_outbox_status_valid" CHECK ("order_notification_outbox"."status" in ('pending', 'sending', 'sent', 'failed')),
	CONSTRAINT "order_notification_outbox_attempts_nonnegative" CHECK ("order_notification_outbox"."attempts" >= 0),
	CONSTRAINT "order_notification_outbox_recipient_present" CHECK (length(trim("order_notification_outbox"."recipient_email")) > 0)
);
--> statement-breakpoint
ALTER TABLE "order_notification_outbox" ADD CONSTRAINT "order_notification_outbox_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_notification_outbox_event_key_unique" ON "order_notification_outbox" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "order_notification_outbox_status_available_idx" ON "order_notification_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "order_notification_outbox_order_id_idx" ON "order_notification_outbox" USING btree ("order_id");