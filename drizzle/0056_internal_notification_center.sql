CREATE TABLE "internal_notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"topic" text NOT NULL,
	"source_event_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"resource_reference" text NOT NULL,
	"recipient_id" uuid NOT NULL,
	"recipient_email" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"provider_message_id" text,
	"last_error_code" text,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "internal_notification_outbox_topic_valid" CHECK ("internal_notification_outbox"."topic" in ('manual_order_created', 'web_order_paid', 'payment_request_paid', 'proof_approved', 'proof_changes_requested')),
	CONSTRAINT "internal_notification_outbox_resource_type_valid" CHECK ("internal_notification_outbox"."resource_type" in ('production_job', 'order', 'payment_request', 'proof_review')),
	CONSTRAINT "internal_notification_outbox_status_valid" CHECK ("internal_notification_outbox"."status" in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
	CONSTRAINT "internal_notification_outbox_payload_object" CHECK (jsonb_typeof("internal_notification_outbox"."payload") = 'object'),
	CONSTRAINT "internal_notification_outbox_attempts_nonnegative" CHECK ("internal_notification_outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "internal_notification_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"status" text DEFAULT 'pending_verification' NOT NULL,
	"verification_token_digest" text,
	"verification_expires_at" timestamp with time zone,
	"verification_issued_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"disabled_by_user_id" text,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "internal_notification_recipients_email_normalized" CHECK (length("internal_notification_recipients"."email") > 0 and "internal_notification_recipients"."email" = lower(trim("internal_notification_recipients"."email"))),
	CONSTRAINT "internal_notification_recipients_status_valid" CHECK ("internal_notification_recipients"."status" in ('pending_verification', 'active', 'disabled')),
	CONSTRAINT "internal_notification_recipients_verification_token_digest_format" CHECK ("internal_notification_recipients"."verification_token_digest" is null or "internal_notification_recipients"."verification_token_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "internal_notification_recipients_lifecycle_valid" CHECK ((
        ("internal_notification_recipients"."status" = 'pending_verification'
          and "internal_notification_recipients"."verification_token_digest" is not null
          and "internal_notification_recipients"."verification_issued_at" is not null
          and "internal_notification_recipients"."verification_expires_at" is not null
          and "internal_notification_recipients"."verification_expires_at" > "internal_notification_recipients"."verification_issued_at"
          and "internal_notification_recipients"."verified_at" is null
          and "internal_notification_recipients"."disabled_at" is null
          and "internal_notification_recipients"."disabled_by_user_id" is null)
        or ("internal_notification_recipients"."status" = 'active'
          and "internal_notification_recipients"."verification_token_digest" is null
          and "internal_notification_recipients"."verification_issued_at" is null
          and "internal_notification_recipients"."verification_expires_at" is null
          and "internal_notification_recipients"."verified_at" is not null
          and "internal_notification_recipients"."disabled_at" is null
          and "internal_notification_recipients"."disabled_by_user_id" is null)
        or ("internal_notification_recipients"."status" = 'disabled'
          and "internal_notification_recipients"."verification_token_digest" is null
          and "internal_notification_recipients"."verification_issued_at" is null
          and "internal_notification_recipients"."verification_expires_at" is null
          and "internal_notification_recipients"."disabled_at" is not null)
      ))
);
--> statement-breakpoint
CREATE TABLE "internal_notification_subscriptions" (
	"recipient_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "internal_notification_subscriptions_recipient_id_topic_pk" PRIMARY KEY("recipient_id","topic"),
	CONSTRAINT "internal_notification_subscriptions_topic_valid" CHECK ("internal_notification_subscriptions"."topic" in ('manual_order_created', 'web_order_paid', 'payment_request_paid', 'proof_approved', 'proof_changes_requested'))
);
--> statement-breakpoint
ALTER TABLE "internal_notification_outbox" ADD CONSTRAINT "internal_notification_outbox_recipient_id_internal_notification_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."internal_notification_recipients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_notification_recipients" ADD CONSTRAINT "internal_notification_recipients_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_notification_recipients" ADD CONSTRAINT "internal_notification_recipients_disabled_by_user_id_user_id_fk" FOREIGN KEY ("disabled_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_notification_subscriptions" ADD CONSTRAINT "internal_notification_subscriptions_recipient_id_internal_notification_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."internal_notification_recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "internal_notification_outbox_event_key_unique" ON "internal_notification_outbox" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "internal_notification_outbox_recipient_id_idx" ON "internal_notification_outbox" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "internal_notification_outbox_status_available_idx" ON "internal_notification_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "internal_notification_recipients_email_unique" ON "internal_notification_recipients" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "internal_notification_recipients_verification_token_digest_unique" ON "internal_notification_recipients" USING btree ("verification_token_digest");--> statement-breakpoint
CREATE INDEX "internal_notification_recipients_status_idx" ON "internal_notification_recipients" USING btree ("status");--> statement-breakpoint
CREATE INDEX "internal_notification_subscriptions_topic_idx" ON "internal_notification_subscriptions" USING btree ("topic","recipient_id");