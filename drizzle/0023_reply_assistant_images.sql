CREATE TABLE "customer_service_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"external_attachment_key_hash" text NOT NULL,
	"ordinal" integer NOT NULL,
	"kind" text DEFAULT 'image' NOT NULL,
	"status" text DEFAULT 'metadata_received' NOT NULL,
	"mime_type_hint" text,
	"verified_mime_type" text,
	"width" integer,
	"height" integer,
	"byte_size" integer,
	"private_storage_key" text,
	"sha256" text,
	"failure_code" text,
	"delete_due_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_attachments_id_message_unique" UNIQUE("id","message_id"),
	CONSTRAINT "customer_service_attachments_external_hash_valid" CHECK (length(trim("customer_service_attachments"."external_attachment_key_hash")) > 0),
	CONSTRAINT "customer_service_attachments_ordinal_valid" CHECK ("customer_service_attachments"."ordinal" >= 0),
	CONSTRAINT "customer_service_attachments_kind_valid" CHECK ("customer_service_attachments"."kind" = 'image'),
	CONSTRAINT "customer_service_attachments_status_valid" CHECK ("customer_service_attachments"."status" in ('metadata_received', 'stored', 'analyzed', 'rejected', 'failed', 'deleted')),
	CONSTRAINT "customer_service_attachments_mime_valid" CHECK ("customer_service_attachments"."verified_mime_type" is null or "customer_service_attachments"."verified_mime_type" in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "customer_service_attachments_dimensions_valid" CHECK (coalesce("customer_service_attachments"."width", 0) >= 0 and coalesce("customer_service_attachments"."height", 0) >= 0 and coalesce("customer_service_attachments"."byte_size", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "customer_service_image_analysis_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" text NOT NULL,
	"provider_called" boolean DEFAULT false NOT NULL,
	"provider" text,
	"model" text,
	"schema_version" text NOT NULL,
	"analysis_result" jsonb,
	"validator_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_tokens" integer,
	"cached_input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost_microusd" bigint,
	"latency_ms" integer,
	"provider_error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "customer_service_image_analysis_attempts_id_message_unique" UNIQUE("id","message_id"),
	CONSTRAINT "customer_service_image_analysis_attempts_number_valid" CHECK ("customer_service_image_analysis_attempts"."attempt_number" > 0),
	CONSTRAINT "customer_service_image_analysis_attempts_status_valid" CHECK ("customer_service_image_analysis_attempts"."status" in ('pending', 'provider_pending', 'analyzed', 'input_rejected', 'provider_error', 'schema_blocked')),
	CONSTRAINT "customer_service_image_analysis_attempts_usage_valid" CHECK (coalesce("customer_service_image_analysis_attempts"."input_tokens", 0) >= 0 and coalesce("customer_service_image_analysis_attempts"."cached_input_tokens", 0) >= 0 and coalesce("customer_service_image_analysis_attempts"."output_tokens", 0) >= 0 and coalesce("customer_service_image_analysis_attempts"."estimated_cost_microusd", 0) >= 0 and coalesce("customer_service_image_analysis_attempts"."latency_ms", 0) >= 0),
	CONSTRAINT "customer_service_image_analysis_attempts_terminal_valid" CHECK ("customer_service_image_analysis_attempts"."status" in ('pending', 'provider_pending') or "customer_service_image_analysis_attempts"."completed_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "customer_service_image_analysis_inputs" (
	"analysis_attempt_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	CONSTRAINT "customer_service_image_analysis_inputs_ordinal_valid" CHECK ("customer_service_image_analysis_inputs"."ordinal" >= 0)
);
--> statement-breakpoint
ALTER TABLE "customer_service_messages" ADD COLUMN "customer_text" text;--> statement-breakpoint
ALTER TABLE "customer_service_attachments" ADD CONSTRAINT "customer_service_attachments_message_id_customer_service_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."customer_service_messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_image_analysis_attempts" ADD CONSTRAINT "customer_service_image_analysis_attempts_message_id_customer_service_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."customer_service_messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_image_analysis_inputs" ADD CONSTRAINT "customer_service_image_analysis_inputs_attempt_message_fk" FOREIGN KEY ("analysis_attempt_id","message_id") REFERENCES "public"."customer_service_image_analysis_attempts"("id","message_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_image_analysis_inputs" ADD CONSTRAINT "customer_service_image_analysis_inputs_attachment_message_fk" FOREIGN KEY ("attachment_id","message_id") REFERENCES "public"."customer_service_attachments"("id","message_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_attachments_message_external_unique" ON "customer_service_attachments" USING btree ("message_id","external_attachment_key_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_attachments_message_ordinal_unique" ON "customer_service_attachments" USING btree ("message_id","ordinal");--> statement-breakpoint
CREATE INDEX "customer_service_attachments_status_delete_due_idx" ON "customer_service_attachments" USING btree ("status","delete_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_image_analysis_attempts_message_number_unique" ON "customer_service_image_analysis_attempts" USING btree ("message_id","attempt_number");--> statement-breakpoint
CREATE INDEX "customer_service_image_analysis_attempts_message_started_idx" ON "customer_service_image_analysis_attempts" USING btree ("message_id","started_at");--> statement-breakpoint
CREATE INDEX "customer_service_image_analysis_attempts_status_started_idx" ON "customer_service_image_analysis_attempts" USING btree ("status","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_image_analysis_inputs_attempt_attachment_unique" ON "customer_service_image_analysis_inputs" USING btree ("analysis_attempt_id","attachment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_image_analysis_inputs_attempt_ordinal_unique" ON "customer_service_image_analysis_inputs" USING btree ("analysis_attempt_id","ordinal");--> statement-breakpoint
CREATE INDEX "customer_service_image_analysis_inputs_attachment_idx" ON "customer_service_image_analysis_inputs" USING btree ("attachment_id");