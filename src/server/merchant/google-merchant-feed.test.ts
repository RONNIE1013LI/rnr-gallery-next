import { describe, expect, it } from "vitest";
import type { MerchantProductData } from "@/domain/catalogue/merchant-product-data";
import { serializeGoogleMerchantFeed } from "@/server/merchant/google-merchant-feed";

function shippingBlocks(xml: string): string[] {
  return xml.match(/<g:shipping>[\s\S]*?<\/g:shipping>/g) ?? [];
}

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

  it("uses the authoritative fixed Australian Standard and DHL rates per variant", () => {
    const xml = serializeGoogleMerchantFeed({
      market: "AU",
      products: [{
        ...item,
        id: "au:photo-print-canvas:a0",
        productKey: "photo-print-canvas",
        sizeKey: "a0",
        itemGroupId: "au:photo-print-canvas",
        currency: "AUD",
        shippingLabel: "AU",
      }],
      generatedAt: new Date("2026-08-28T00:00:00.000Z"),
    });

    const blocks = shippingBlocks(xml);
    expect(blocks.length).toBeLessThanOrEqual(100);
    const standard = blocks.find((block) => block.includes("Standard Shipping"));
    const dhlBlocks = blocks.filter((block) => block.includes("DHL Express"));
    const deliveryFor = (postcode: number) => dhlBlocks.filter((block) => {
      const area = block.match(/<g:postal_code>(\d{4})(?:-(\d{4}))?<\/g:postal_code>/);
      return area && postcode >= Number(area[1]) && postcode <= Number(area[2] ?? area[1]);
    });
    expect(standard).toContain("<g:price>120.00 AUD</g:price>");
    expect(standard).toContain("<g:min_transit_time>7</g:min_transit_time>");
    expect(standard).toContain("<g:max_transit_time>14</g:max_transit_time>");
    // Eastern city centres, including the regional cities, retain the express estimate.
    for (const postcode of [2000, 2250, 2300, 2486, 2500, 2600, 2900, 3000, 3207, 3216, 4000, 4217, 4556]) {
      const matches = deliveryFor(postcode);
      expect(matches, `DHL coverage for ${postcode}`).toHaveLength(1);
      expect(matches[0]).toContain("<g:min_transit_time>2</g:min_transit_time>");
      expect(matches[0]).toContain("<g:max_transit_time>3</g:max_transit_time>");
    }
    // DHL's remote list overrides city geography; the nationwide fallback is retained.
    for (const postcode of [2315, 2485, 2563, 2573, 2753, 2775, 3115, 3159, 3341, 4025, 4183, 4211, 4228, 4550, 4565, 4810, 6000]) {
      const matches = deliveryFor(postcode);
      expect(matches, `DHL conservative coverage for ${postcode}`).toHaveLength(1);
      expect(matches[0]).toContain("<g:max_transit_time>14</g:max_transit_time>");
    }
    for (let postcode = 0; postcode <= 9999; postcode += 1) {
      expect(deliveryFor(postcode), `DHL coverage for ${postcode}`).toHaveLength(1);
    }
    expect(dhlBlocks.every((block) => block.includes("<g:price>186.00 AUD</g:price>"))).toBe(true);
    expect(blocks.every((block) => block.includes("<g:min_handling_time>3</g:min_handling_time>"))).toBe(true);
    expect(blocks.every((block) => block.includes("<g:max_handling_time>3</g:max_handling_time>"))).toBe(true);
  });

  it("uses one conservative nationwide New Zealand rate without region codes", () => {
    const xml = serializeGoogleMerchantFeed({
      market: "NZ",
      products: [item],
      generatedAt: new Date("2026-08-28T00:00:00.000Z"),
    });

    const blocks = shippingBlocks(xml);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain("<g:country>NZ</g:country>");
    expect(blocks[0]).not.toContain("<g:region>");
    expect(blocks[0]).toContain("<g:price>50.00 NZD</g:price>");
    expect(blocks[0]).toContain("<g:service>GoSweetSpot delivery estimate</g:service>");
    expect(blocks[0]).toContain("<g:min_transit_time>2</g:min_transit_time>");
    expect(blocks[0]).toContain("<g:max_transit_time>3</g:max_transit_time>");
  });
});
