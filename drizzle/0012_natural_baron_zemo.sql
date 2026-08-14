CREATE TABLE "production_job_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"version" integer,
	"original_name" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_job_files_kind_valid" CHECK ("production_job_files"."kind" in ('customer_file', 'payment_proof', 'design_draft', 'print_file')),
	CONSTRAINT "production_job_files_version_valid" CHECK (("production_job_files"."kind" = 'design_draft' and "production_job_files"."version" is not null and "production_job_files"."version" > 0)
        or ("production_job_files"."kind" <> 'design_draft' and "production_job_files"."version" is null)),
	CONSTRAINT "production_job_files_size_valid" CHECK ("production_job_files"."size_bytes" between 1 and 26214400),
	CONSTRAINT "production_job_files_sha256_valid" CHECK ("production_job_files"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "production_job_files_metadata_present" CHECK (length(trim("production_job_files"."original_name")) > 0
        and length(trim("production_job_files"."media_type")) > 0
        and length(trim("production_job_files"."storage_key")) > 0)
);
--> statement-breakpoint
CREATE TABLE "production_proof_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"recorded_by_user_id" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_proof_reviews_decision_valid" CHECK ("production_proof_reviews"."decision" in ('approved', 'changes_requested')),
	CONSTRAINT "production_proof_reviews_notes_length" CHECK (length("production_proof_reviews"."notes") <= 5000)
);
--> statement-breakpoint
CREATE TABLE "production_saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"query_string" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_saved_views_name_valid" CHECK (length(trim("production_saved_views"."name")) between 1 and 80),
	CONSTRAINT "production_saved_views_query_valid" CHECK (length("production_saved_views"."query_string") between 1 and 2000
        and "production_saved_views"."query_string" not like '%://%'
        and "production_saved_views"."query_string" not like '%?%'
        and "production_saved_views"."query_string" not like '%#%')
);
--> statement-breakpoint
ALTER TABLE "production_job_files" ADD CONSTRAINT "production_job_files_job_id_production_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."production_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_job_files" ADD CONSTRAINT "production_job_files_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_proof_reviews" ADD CONSTRAINT "production_proof_reviews_job_id_production_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."production_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_proof_reviews" ADD CONSTRAINT "production_proof_reviews_file_id_production_job_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."production_job_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_proof_reviews" ADD CONSTRAINT "production_proof_reviews_recorded_by_user_id_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_saved_views" ADD CONSTRAINT "production_saved_views_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "production_job_files_job_id_idx" ON "production_job_files" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "production_job_files_kind_idx" ON "production_job_files" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "production_job_files_job_version_unique" ON "production_job_files" USING btree ("job_id","version") WHERE "production_job_files"."kind" = 'design_draft';--> statement-breakpoint
CREATE UNIQUE INDEX "production_job_files_storage_key_unique" ON "production_job_files" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "production_proof_reviews_file_unique" ON "production_proof_reviews" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_proof_reviews_idempotency_unique" ON "production_proof_reviews" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "production_proof_reviews_job_id_idx" ON "production_proof_reviews" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_saved_views_user_name_unique" ON "production_saved_views" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "production_saved_views_user_id_idx" ON "production_saved_views" USING btree ("user_id");