CREATE TABLE "customer_service_conversation_identities" (
	"conversation_id" uuid PRIMARY KEY,
	"channel" text,
	"identity_kind" text,
	"identity_key_hash" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
WITH "website_identity_evidence" AS (
	SELECT
		"conversation_id",
		min("visitor_digest") AS "identity_key_hash"
	FROM "website_analytics_conversions"
	WHERE "conversion_type" = 'inquiry'
		AND "source_type" = 'customer_service_conversation'
		AND "consent_linked" = true
		AND "visitor_digest" IS NOT NULL
	GROUP BY "conversation_id"
	HAVING count(DISTINCT "visitor_digest") = 1
)
INSERT INTO "customer_service_conversation_identities" (
	"conversation_id",
	"channel",
	"identity_kind",
	"identity_key_hash",
	"created_at",
	"updated_at"
)
SELECT
	"conversations"."id",
	"conversations"."channel",
	CASE
		WHEN "conversations"."channel" = 'facebook' THEN 'facebook_psid'
		WHEN "evidence"."identity_key_hash" IS NOT NULL THEN 'website_stable_visitor'
		ELSE 'website_conversation'
	END,
	CASE
		WHEN "conversations"."channel" = 'website'
			AND "evidence"."identity_key_hash" IS NOT NULL
			THEN "evidence"."identity_key_hash"
		ELSE "conversations"."external_key_hash"
	END,
	"conversations"."created_at",
	"conversations"."updated_at"
FROM "customer_service_conversations" AS "conversations"
LEFT JOIN "website_identity_evidence" AS "evidence"
	ON "conversations"."channel" = 'website'
	AND "evidence"."conversation_id" = "conversations"."id";
--> statement-breakpoint
ALTER TABLE "customer_service_conversation_identities"
	ALTER COLUMN "conversation_id" SET NOT NULL,
	ALTER COLUMN "channel" SET NOT NULL,
	ALTER COLUMN "identity_kind" SET NOT NULL,
	ALTER COLUMN "identity_key_hash" SET NOT NULL,
	ALTER COLUMN "created_at" SET NOT NULL,
	ALTER COLUMN "updated_at" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "customer_service_conversation_identities"
	ADD CONSTRAINT "customer_service_conversation_identities_channel_valid"
		CHECK ("channel" in ('facebook', 'website')),
	ADD CONSTRAINT "customer_service_conversation_identities_kind_valid"
		CHECK ("identity_kind" in ('facebook_psid', 'website_authenticated_customer', 'website_stable_visitor', 'website_conversation')),
	ADD CONSTRAINT "customer_service_conversation_identities_hash_valid"
		CHECK ("identity_key_hash" ~ '^[a-f0-9]{64}$');
--> statement-breakpoint
ALTER TABLE "customer_service_conversation_identities"
	ADD CONSTRAINT "customer_service_conversation_identities_conversation_fk"
	FOREIGN KEY ("conversation_id", "channel")
	REFERENCES "public"."customer_service_conversations"("id", "channel")
	ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "customer_service_conversation_identities_lookup_idx"
	ON "customer_service_conversation_identities" USING btree (
		"channel",
		"identity_kind",
		"identity_key_hash"
	);
