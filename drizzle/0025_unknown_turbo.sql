ALTER TABLE "invoices" DROP CONSTRAINT "invoices_currency_nzd";--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_gst_rate_fixed";--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_currency_supported" CHECK ("invoices"."currency" in ('NZD', 'AUD'));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tax_rate_valid" CHECK ("invoices"."gst_rate_basis_points" >= 0 and "invoices"."gst_rate_basis_points" <= 10000 and "invoices"."prices_include_gst" = true);