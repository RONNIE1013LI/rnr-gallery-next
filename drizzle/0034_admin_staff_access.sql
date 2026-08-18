CREATE TABLE "admin_staff_access" (
	"user_id" text PRIMARY KEY NOT NULL,
	"admin_permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"form_permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"assigned_only" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_staff_access_admin_permissions_array" CHECK (jsonb_typeof("admin_staff_access"."admin_permissions") = 'array'),
	CONSTRAINT "admin_staff_access_form_permissions_object" CHECK (jsonb_typeof("admin_staff_access"."form_permissions") = 'object')
);
--> statement-breakpoint
ALTER TABLE "admin_staff_access" ADD CONSTRAINT "admin_staff_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "admin_staff_access" ("user_id", "admin_permissions", "form_permissions", "assigned_only")
SELECT "id", '["access_admin","view_orders","update_order_status","view_customers","manage_gallery","manage_content","view_production_jobs","create_manual_jobs","update_production_jobs","view_production_files","upload_production_files","review_production_proofs","manage_production_views","view_production_reports","use_reply_assistant"]'::jsonb, '{"access_forms":true,"view_jobs":true,"create_jobs":true,"update_jobs":true,"delete_jobs":false,"view_customer_contact":true,"view_finance":false,"update_finance":false,"view_payment_proof":false,"view_files":true,"upload_files":true,"delete_files":false,"update_production_status":true,"update_delivery_status":true,"view_stats":true,"manage_stats":true,"export_jobs":false,"manage_views":true,"view_audit":false}'::jsonb, false
FROM "user"
WHERE "role" = 'staff'
ON CONFLICT ("user_id") DO NOTHING;
