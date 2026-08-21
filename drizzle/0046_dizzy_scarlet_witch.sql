CREATE TABLE "customer_service_website_budget_state" (
	"scope_key" text PRIMARY KEY NOT NULL,
	"spent_microusd" bigint DEFAULT 0 NOT NULL,
	"reserved_microusd" bigint DEFAULT 0 NOT NULL,
	"warning_reached_at" timestamp with time zone,
	"warning_threshold_microusd" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_website_budget_state_scope_valid" CHECK ("customer_service_website_budget_state"."scope_key" = 'total:website' or "customer_service_website_budget_state"."scope_key" ~ '^daily:website:[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "customer_service_website_budget_state_amounts_valid" CHECK ("customer_service_website_budget_state"."spent_microusd" >= 0 and "customer_service_website_budget_state"."reserved_microusd" >= 0),
	CONSTRAINT "customer_service_website_budget_state_warning_valid" CHECK (("customer_service_website_budget_state"."warning_reached_at" is null and "customer_service_website_budget_state"."warning_threshold_microusd" is null) or ("customer_service_website_budget_state"."warning_reached_at" is not null and "customer_service_website_budget_state"."warning_threshold_microusd" > 0))
);
