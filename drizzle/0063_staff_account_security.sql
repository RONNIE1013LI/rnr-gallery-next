-- Additive staff authentication schema only. Existing users remain intact.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "staff_passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "staff_security" (
	"user_id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"fallback_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_security_role_valid" CHECK ("staff_security"."role" in ('owner','admin','staff','customer_service','designer','production','temporary'))
);
--> statement-breakpoint
CREATE TABLE "staff_security_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"rollout_at" timestamp with time zone NOT NULL,
	"enforced_at" timestamp with time zone,
	"activated_by" text NOT NULL,
	CONSTRAINT "staff_security_policy_singleton" CHECK ("staff_security_policy"."id" = 'primary')
);
--> statement-breakpoint
CREATE TABLE "staff_session_security" (
	"session_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"mfa_at" timestamp with time zone,
	"elevated_at" timestamp with time zone,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"factor" text
);
--> statement-breakpoint
CREATE TABLE "staff_two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff_passkey" ADD CONSTRAINT "staff_passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_security" ADD CONSTRAINT "staff_security_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_security_policy" ADD CONSTRAINT "staff_security_policy_activated_by_user_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_session_security" ADD CONSTRAINT "staff_session_security_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_session_security" ADD CONSTRAINT "staff_session_security_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_two_factor" ADD CONSTRAINT "staff_two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "staff_passkey_credential_unique" ON "staff_passkey" USING btree ("credential_id");
--> statement-breakpoint
CREATE INDEX "staff_passkey_user_idx" ON "staff_passkey" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "staff_session_security_user_idx" ON "staff_session_security" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "staff_two_factor_user_unique" ON "staff_two_factor" USING btree ("user_id");
