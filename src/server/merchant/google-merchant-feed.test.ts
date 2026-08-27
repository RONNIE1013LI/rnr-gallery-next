import { describe, expect, it } from "vitest";
import type { MerchantProductData } from "@/domain/catalogue/merchant-product-data";
import { serializeGoogleMerchantFeed } from "@/server/merchant/google-merchant-feed";

const item: MerchantProductData = {
  id: "nz:canvas:40x30",
  productKey: "canvas",
  sizeKey: "40x30",
  itemGroupId: "nz:canvas",
  size: "40 × 30 cm",
  title: "Canvas & frame < custom >",
  description: "Made to order & approved before print.",
  link: "https://rnrgallery.com/products/canvas?size=40x30&source=feed",
  imageLink: "https://rnrgallery.com/media/canvas.webp?size=large&format=webp",
  currency: "NZD",
  priceInclTaxCents: 12_345,
  availability: "in_stock",
  brand: "R&R Gallery",
  condition: "new",
  identifierExists: false,
  shippingLabel: "NZ",
};

describe("serializeGoogleMerchantFeed", () => {
  it("writes an escaped Google RSS item with only supported merchant fields", () => {
    const xml = serializeGoogleMerchantFeed({
      market: "NZ",
      products: [item],
      generatedAt: new Date("2026-08-28T00:00:00.000Z"),
    });

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('xmlns:g="http://base.google.com/ns/1.0"');
    expect(xml).toContain("<g:id>nz:canvas:40x30</g:id>");
    expect(xml).toContain("<g:item_group_id>nz:canvas</g:item_group_id>");
    expect(xml).toContain("<g:size>40 × 30 cm</g:size>");
    expect(xml).toContain("<g:identifier_exists>no</g:identifier_exists>");
    expect(xml).toContain("<g:price>123.45 NZD</g:price>");
    expect(xml).toContain("<g:availability>in_stock</g:availability>");
    expect(xml).toContain("<g:condition>new</g:condition>");
    expect(xml).toContain("<g:brand>R&amp;R Gallery</g:brand>");
    expect(xml).toContain("<g:shipping_label>NZ</g:shipping_label>");
    expect(xml).toContain("Canvas &amp; frame &lt; custom &gt;");
    expect(xml).toContain("https://rnrgallery.com/products/canvas?size=40x30&amp;source=feed");
    expect(xml).toContain("https://rnrgallery.com/media/canvas.webp?size=large&amp;format=webp");
    expect(xml).not.toMatch(/return|refund/i);
  });
});
