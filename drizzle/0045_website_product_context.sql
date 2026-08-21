ALTER TABLE "customer_service_messages" ADD COLUMN "product_context" jsonb;--> statement-breakpoint
ALTER TABLE "customer_service_messages" ADD CONSTRAINT "customer_service_messages_product_context_valid" CHECK ("customer_service_messages"."product_context" is null or (
        "customer_service_messages"."channel" = 'website'
        and jsonb_typeof("customer_service_messages"."product_context") = 'object'
        and "customer_service_messages"."product_context" ?& array['market', 'productKey', 'productTitle', 'category', 'pageKind']
        and ("customer_service_messages"."product_context" - 'market' - 'productKey' - 'productTitle' - 'category' - 'pageKind') = '{}'::jsonb
        and jsonb_typeof("customer_service_messages"."product_context"->'productKey') = 'string'
        and jsonb_typeof("customer_service_messages"."product_context"->'productTitle') = 'string'
        and "customer_service_messages"."product_context"->>'market' in ('NZ', 'AU')
        and length(trim("customer_service_messages"."product_context"->>'productKey')) between 1 and 100
        and length(trim("customer_service_messages"."product_context"->>'productTitle')) between 1 and 160
        and "customer_service_messages"."product_context"->>'category' in ('canvas', 'banners')
        and "customer_service_messages"."product_context"->>'pageKind' in ('product', 'configure')
      ));