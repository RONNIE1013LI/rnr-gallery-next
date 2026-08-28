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
    expect(blocks).toHaveLength(2);
    const standard = blocks.find((block) => block.includes("Standard Shipping"));
    const dhl = blocks.find((block) => block.includes("DHL Express"));
    expect(standard).toContain("<g:price>120.00 AUD</g:price>");
    expect(standard).toContain("<g:min_transit_time>7</g:min_transit_time>");
    expect(standard).toContain("<g:max_transit_time>14</g:max_transit_time>");
    expect(dhl).toContain("<g:price>186.00 AUD</g:price>");
    expect(dhl).toContain("<g:min_transit_time>2</g:min_transit_time>");
    expect(dhl).toContain("<g:max_transit_time>14</g:max_transit_time>");
    expect(blocks.every((block) => block.includes("<g:min_handling_time>5</g:min_handling_time>"))).toBe(true);
    expect(blocks.every((block) => block.includes("<g:max_handling_time>5</g:max_handling_time>"))).toBe(true);
  });

  it("uses conservative region-level New Zealand rates audited against live checkout", () => {
    const xml = serializeGoogleMerchantFeed({
      market: "NZ",
      products: [item],
      generatedAt: new Date("2026-08-28T00:00:00.000Z"),
    });

    const blocks = shippingBlocks(xml);
    expect(blocks).toHaveLength(17);
    const expectedRates = {
      AUK: "25.00 NZD",
      NTL: "30.00 NZD",
      BOP: "25.00 NZD",
      GIS: "25.00 NZD",
      HKB: "25.00 NZD",
      MWT: "25.00 NZD",
      TKI: "25.00 NZD",
      WGN: "25.00 NZD",
      WKO: "25.00 NZD",
      CAN: "50.00 NZD",
      CIT: "25.00 NZD",
      MBH: "50.00 NZD",
      NSN: "50.00 NZD",
      OTA: "50.00 NZD",
      STL: "50.00 NZD",
      TAS: "50.00 NZD",
      WTC: "50.00 NZD",
    } as const;
    for (const [region, price] of Object.entries(expectedRates)) {
      const block = blocks.find((candidate) => candidate.includes(`<g:region>${region}</g:region>`));
      expect(block).toContain(`<g:price>${price}</g:price>`);
      expect(block).toContain("<g:service>GoSweetSpot delivery</g:service>");
      expect(block).toContain("<g:min_transit_time>2</g:min_transit_time>");
      expect(block).toContain("<g:max_transit_time>3</g:max_transit_time>");
    }
  });
});
