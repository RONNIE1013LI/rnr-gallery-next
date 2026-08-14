CREATE TABLE "product_registry_current" (
	"registry_key" text PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"published_by" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_registry_current_key_valid" CHECK ("product_registry_current"."registry_key" = 'primary'),
	CONSTRAINT "product_registry_current_revision_positive" CHECK ("product_registry_current"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "product_registry_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registry_key" text NOT NULL,
	"revision" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"published_by" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_registry_revisions_key_valid" CHECK ("product_registry_revisions"."registry_key" = 'primary'),
	CONSTRAINT "product_registry_revisions_revision_positive" CHECK ("product_registry_revisions"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "product_registry_current" ADD CONSTRAINT "product_registry_current_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_registry_revisions" ADD CONSTRAINT "product_registry_revisions_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_registry_revisions_key_revision_unique" ON "product_registry_revisions" USING btree ("registry_key","revision");--> statement-breakpoint
CREATE INDEX "product_registry_revisions_published_at_idx" ON "product_registry_revisions" USING btree ("published_at");