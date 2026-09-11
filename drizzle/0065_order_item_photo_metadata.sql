ALTER TABLE "order_items" ADD COLUMN "photo_metadata" jsonb DEFAULT '[]'::jsonb NOT NULL;
