ALTER TABLE "gallery_designs" ADD CONSTRAINT "gallery_designs_product_mapping_valid" CHECK ((
        "gallery_designs"."product_type_slug" = 'canvas'
        and "gallery_designs"."product_slug" in ('digital-oil-painting-canvas', 'custom-themed-canvas')
      ) or (
        "gallery_designs"."product_type_slug" = 'grave-cover'
        and "gallery_designs"."product_slug" = 'grave-cover'
      ) or (
        "gallery_designs"."product_type_slug" = 'roll-up-banner'
        and "gallery_designs"."product_slug" = 'roll-up-banner'
      ) or (
        "gallery_designs"."product_type_slug" = 'wall-hanging-banners'
        and "gallery_designs"."product_slug" = 'custom-themed-wall-banner'
      ));