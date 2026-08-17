CREATE TABLE "customer_service_conversation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"turn_id" uuid,
	"legacy_message_id" uuid,
	"channel" text NOT NULL,
	"external_message_key_hash" text NOT NULL,
	"role" text NOT NULL,
	"body" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_conversation_events_channel_valid" CHECK ("customer_service_conversation_events"."channel" in ('facebook', 'website')),
	CONSTRAINT "customer_service_conversation_events_role_valid" CHECK ("customer_service_conversation_events"."role" in ('customer', 'staff')),
	CONSTRAINT "customer_service_conversation_events_body_valid" CHECK (length(trim("customer_service_conversation_events"."body")) > 0),
	CONSTRAINT "customer_service_conversation_events_external_hash_valid" CHECK (length(trim("customer_service_conversation_events"."external_message_key_hash")) > 0),
	CONSTRAINT "customer_service_conversation_events_customer_message_valid" CHECK (("customer_service_conversation_events"."role" = 'customer' and "customer_service_conversation_events"."legacy_message_id" is not null) or ("customer_service_conversation_events"."role" = 'staff' and "customer_service_conversation_events"."legacy_message_id" is null))
);
--> statement-breakpoint
CREATE TABLE "customer_service_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"representative_message_id" uuid,
	"body" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"debounce_until" timestamp with time zone NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"last_event_at" timestamp with time zone NOT NULL,
	"sealed_at" timestamp with time zone,
	"suppression_reason" text,
	"fragment_count" integer DEFAULT 1 NOT NULL,
	"pilot_run_id" uuid,
	"pilot_sequence" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_turns_channel_valid" CHECK ("customer_service_turns"."channel" in ('facebook', 'website')),
	CONSTRAINT "customer_service_turns_status_valid" CHECK ("customer_service_turns"."status" in ('open', 'sealed', 'suppressed', 'pilot_complete')),
	CONSTRAINT "customer_service_turns_body_valid" CHECK (length(trim("customer_service_turns"."body")) > 0),
	CONSTRAINT "customer_service_turns_fragment_count_valid" CHECK ("customer_service_turns"."fragment_count" > 0),
	CONSTRAINT "customer_service_turns_pilot_pair_valid" CHECK (("customer_service_turns"."pilot_run_id" is null and "customer_service_turns"."pilot_sequence" is null) or ("customer_service_turns"."pilot_run_id" is not null and "customer_service_turns"."pilot_sequence" is not null and "customer_service_turns"."pilot_sequence" > 0))
);
--> statement-breakpoint
ALTER TABLE "customer_service_conversation_events" ADD CONSTRAINT "customer_service_conversation_events_conversation_id_customer_service_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."customer_service_conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_conversation_events" ADD CONSTRAINT "customer_service_conversation_events_turn_id_customer_service_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."customer_service_turns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_conversation_events" ADD CONSTRAINT "customer_service_conversation_events_legacy_message_id_customer_service_messages_id_fk" FOREIGN KEY ("legacy_message_id") REFERENCES "public"."customer_service_messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_turns" ADD CONSTRAINT "customer_service_turns_conversation_id_customer_service_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."customer_service_conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_turns" ADD CONSTRAINT "customer_service_turns_representative_message_id_customer_service_messages_id_fk" FOREIGN KEY ("representative_message_id") REFERENCES "public"."customer_service_messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_turns" ADD CONSTRAINT "customer_service_turns_pilot_run_id_customer_service_pilot_runs_id_fk" FOREIGN KEY ("pilot_run_id") REFERENCES "public"."customer_service_pilot_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_conversation_events_channel_external_unique" ON "customer_service_conversation_events" USING btree ("channel","external_message_key_hash");--> statement-breakpoint
CREATE INDEX "customer_service_conversation_events_conversation_received_idx" ON "customer_service_conversation_events" USING btree ("conversation_id","received_at","created_at");--> statement-breakpoint
CREATE INDEX "customer_service_conversation_events_turn_idx" ON "customer_service_conversation_events" USING btree ("turn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_turns_pilot_sequence_unique" ON "customer_service_turns" USING btree ("pilot_run_id","pilot_sequence") WHERE "customer_service_turns"."pilot_run_id" is not null and "customer_service_turns"."pilot_sequence" is not null;--> statement-breakpoint
CREATE INDEX "customer_service_turns_conversation_last_event_idx" ON "customer_service_turns" USING btree ("conversation_id","last_event_at");--> statement-breakpoint
CREATE INDEX "customer_service_turns_status_debounce_idx" ON "customer_service_turns" USING btree ("status","debounce_until");
