CREATE TABLE "form_stats_layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"widgets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_stats_layouts_name_valid" CHECK (length(trim("form_stats_layouts"."name")) between 1 and 80),
	CONSTRAINT "form_stats_layouts_widget_count_valid" CHECK (jsonb_typeof("form_stats_layouts"."widgets") = 'array' and jsonb_array_length("form_stats_layouts"."widgets") <= 24 and pg_column_size("form_stats_layouts"."widgets") <= 50000)
);
--> statement-breakpoint
ALTER TABLE "form_stats_layouts" ADD CONSTRAINT "form_stats_layouts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_stats_layouts_user_name_unique" ON "form_stats_layouts" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "form_stats_layouts_user_id_idx" ON "form_stats_layouts" USING btree ("user_id");