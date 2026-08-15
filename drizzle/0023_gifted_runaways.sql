ALTER TABLE "shipping_quotes" DROP CONSTRAINT "shipping_quotes_currency_nzd";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_currency_nzd";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "market" text DEFAULT 'NZ' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "price_book_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tax_jurisdiction" text DEFAULT 'NZ_GST' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tax_rate_basis_points" integer DEFAULT 1500 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "design_surcharge_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pricing_snapshot" jsonb;--> statement-breakpoint
UPDATE "orders" AS "order_snapshot"
SET "pricing_snapshot" = jsonb_build_object(
  'schemaVersion', 1,
  'market', 'NZ',
  'currency', "order_snapshot"."currency",
  'priceBookRevision', 0,
  'taxJurisdiction', 'NZ_GST',
  'taxRateBasisPoints', 1500,
  'items', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'clientItemId', "item_snapshot"."client_item_id",
      'productKey', "item_snapshot"."product_key",
      'sizeKey', "item_snapshot"."size_key",
      'quantity', "item_snapshot"."quantity",
      'unitPrice', jsonb_build_object(
        'market', 'NZ',
        'currency', 'NZD',
        'taxJurisdiction', 'NZ_GST',
        'taxRateBasisPoints', 1500,
        'lines', "item_snapshot"."price_lines",
        'subtotalExGstCents', "item_snapshot"."unit_subtotal_ex_gst_cents",
        'gstCents', "item_snapshot"."unit_gst_cents",
        'totalInclGstCents', "item_snapshot"."unit_total_incl_gst_cents",
        'discountCents', 0,
        'designSurchargeCents', 0
      ),
      'lineSubtotalExTaxCents', "item_snapshot"."line_subtotal_ex_gst_cents",
      'lineTaxCents', "item_snapshot"."line_gst_cents",
      'lineTotalInclTaxCents', "item_snapshot"."line_total_incl_gst_cents"
    ) ORDER BY "item_snapshot"."position")
    FROM "order_items" AS "item_snapshot"
    WHERE "item_snapshot"."order_id" = "order_snapshot"."id"
  ), '[]'::jsonb),
  'productSubtotalExTaxCents', "order_snapshot"."product_subtotal_ex_gst_cents",
  'productTaxCents', "order_snapshot"."product_gst_cents",
  'productTotalInclTaxCents', "order_snapshot"."product_total_incl_gst_cents",
  'designSurchargeCents', 0,
  'discountCents', 0,
  'shipping', jsonb_build_object(
    'method', "order_snapshot"."delivery_method",
    'serviceCode', "order_snapshot"."shipping_service_code",
    'currency', "order_snapshot"."currency",
    'amountExTaxCents', "order_snapshot"."shipping_ex_gst_cents",
    'taxCents', "order_snapshot"."shipping_gst_cents",
    'amountInclTaxCents', "order_snapshot"."shipping_total_incl_gst_cents"
  ),
  'taxAmountCents', "order_snapshot"."total_gst_cents",
  'finalTotalCents', "order_snapshot"."total_incl_gst_cents"
);--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "pricing_snapshot" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shipping_quotes" ADD CONSTRAINT "shipping_quotes_currency_supported" CHECK ("shipping_quotes"."currency" in ('NZD', 'AUD'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_market_supported" CHECK ("orders"."market" in ('NZ', 'AU'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_currency_supported" CHECK ("orders"."currency" in ('NZD', 'AUD'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_market_currency_match" CHECK (("orders"."market" = 'NZ' and "orders"."currency" = 'NZD') or ("orders"."market" = 'AU' and "orders"."currency" = 'AUD'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_price_book_revision_nonnegative" CHECK ("orders"."price_book_revision" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tax_rate_valid" CHECK ("orders"."tax_rate_basis_points" between 0 and 10000);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_discount_nonnegative" CHECK ("orders"."discount_cents" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_design_surcharge_nonnegative" CHECK ("orders"."design_surcharge_cents" >= 0);
