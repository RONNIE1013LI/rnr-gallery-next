CREATE TABLE "form_user_access" (
	"user_id" text PRIMARY KEY NOT NULL,
	"preset" text NOT NULL,
	"assigned_only" boolean DEFAULT false NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_user_access_preset_valid" CHECK ("form_user_access"."preset" in ('manager', 'artist', 'finance', 'readOnly'))
);
--> statement-breakpoint
ALTER TABLE "user" DROP CONSTRAINT "user_role_valid";--> statement-breakpoint
ALTER TABLE "form_user_access" ADD CONSTRAINT "form_user_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_role_valid" CHECK ("user"."role" in ('customer', 'form_staff', 'staff', 'admin'));