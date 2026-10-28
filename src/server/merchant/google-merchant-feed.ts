import { buildMerchantProductData, type MerchantProductData } from "@/domain/catalogue/merchant-product-data";
import type { ProductRegistryDocument } from "@/domain/catalogue/product-registry";
import type { Market } from "@/domain/markets/types";
import { getAustraliaFixedShippingRates } from "@/server/shipping/australia-fixed-shipping";

const xmlHeaders = {
  "Content-Type": "application/rss+xml; charset=utf-8",
  "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=60",
};
const unavailableHeaders = { "Cache-Control": "no-store" };

type MerchantRegistrySnapshot = Readonly<{ registry: ProductRegistryDocument }>;

export type MerchantFeedRouteInput = Readonly<{
  market: Market;
  current: () => Promise<MerchantRegistrySnapshot>;
  siteUrl: URL;
  now?: () => Date;
}>;

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]!);
}

function formatPrice(cents: number, currency: MerchantProductData["currency"]): string {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

// Eastern metro geography: https://auspost.com.au/personal/sending/delivery-speeds-and-coverage
// Central Coast, Newcastle, Wollongong, Geelong and Sunshine Coast: Australia Post's
// z9-pricing-guide-domestic-eparcel-contract.pdf. These define geography, not DHL transit times.
// Excludes DHL's Remote Area Locations, effective 9 August 2026, checked 28 October 2026:
// https://www.dhl.com/content/dam/dhl/global/dhl-express/documents/docs/dhl-express-remote-area-surcharge-locations.xlsx.coredownload.xlsx
const australiaDhlMetroPostcodes = [
  [2000, 2234], [2250, 2263], [2282, 2310], [2486, 2486], [2500, 2532],
  [2555, 2562], [2564, 2572], [2600, 2620], [2740, 2752], [2755, 2756],
  [2758, 2774], [2777, 2778], [2781, 2781], [2900, 2914], [3000, 3114],
  [3116, 3138], [3140, 3158], [3160, 3207], [3211, 3220], [3340, 3340],
  [3750, 3750], [3755, 3757], [4000, 4024], [4026, 4182], [4184, 4210],
  [4212, 4227], [4229, 4269], [4273, 4274], [4500, 4513], [4517, 4518],
  [4520, 4549], [4551, 4551], [4556, 4558], [4564, 4564], [4575, 4579],
] as const;

function australiaDhlShippingXml(price: number): string[] {
  const areas: Array<{ from: number; to: number; maxTransitDays: number }> = [];
  let nextPostcode = 0;
  for (const [from, to] of australiaDhlMetroPostcodes) {
    if (nextPostcode < from) {
      areas.push({ from: nextPostcode, to: from - 1, maxTransitDays: 14 });
    }
    areas.push({ from, to, maxTransitDays: 3 });
    nextPostcode = to + 1;
  }
  areas.push({ from: nextPostcode, to: 9999, maxTransitDays: 14 });

  return areas.flatMap(({ from, to, maxTransitDays }) => {
    const first = String(from).padStart(4, "0");
    const last = String(to).padStart(4, "0");
    return [
      "      <g:shipping>",
      "        <g:country>AU</g:country>",
      `        <g:postal_code>${from === to ? first : `${first}-${last}`}</g:postal_code>`,
      "        <g:service>DHL Express</g:service>",
      `        <g:price>${formatPrice(price, "AUD")}</g:price>`,
      "        <g:min_handling_time>3</g:min_handling_time>",
      "        <g:max_handling_time>3</g:max_handling_time>",
      "        <g:min_transit_time>2</g:min_transit_time>",
      `        <g:max_transit_time>${maxTransitDays}</g:max_transit_time>`,
      "      </g:shipping>",
    ];
  });
}

function australiaShippingXml(product: MerchantProductData): readonly string[] {
  const rates = getAustraliaFixedShippingRates(product.productKey, product.sizeKey);
  return [
    "      <g:shipping>",
    "        <g:country>AU</g:country>",
    "        <g:service>Standard Shipping</g:service>",
    `        <g:price>${formatPrice(rates.standard, "AUD")}</g:price>`,
    "        <g:min_handling_time>3</g:min_handling_time>",
    "        <g:max_handling_time>3</g:max_handling_time>",
    "        <g:min_transit_time>7</g:min_transit_time>",
    "        <g:max_transit_time>14</g:max_transit_time>",
    "      </g:shipping>",
    ...australiaDhlShippingXml(rates.dhlExpress),
  ];
}

function newZealandShippingXml(): readonly string[] {
  return [
    "      <g:shipping>",
    "        <g:country>NZ</g:country>",
    "        <g:service>GoSweetSpot delivery estimate</g:service>",
    "        <g:price>50.00 NZD</g:price>",
    "        <g:min_handling_time>5</g:min_handling_time>",
    "        <g:max_handling_time>5</g:max_handling_time>",
    "        <g:min_transit_time>2</g:min_transit_time>",
    "        <g:max_transit_time>3</g:max_transit_time>",
    "      </g:shipping>",
  ];
}

function shippingXml(product: MerchantProductData, market: Market): readonly string[] {
  return market === "AU" ? australiaShippingXml(product) : newZealandShippingXml();
}

function itemXml(product: MerchantProductData, market: Market): string {
  return [
    "    <item>",
    `      <g:id>${escapeXml(product.id)}</g:id>`,
    `      <g:item_group_id>${escapeXml(product.itemGroupId)}</g:item_group_id>`,
    `      <title>${escapeXml(product.title)}</title>`,
    `      <description>${escapeXml(product.description)}</description>`,
    `      <link>${escapeXml(product.link)}</link>`,
    `      <g:image_link>${escapeXml(product.imageLink)}</g:image_link>`,
    `      <g:price>${formatPrice(product.priceInclTaxCents, product.currency)}</g:price>`,
    `      <g:availability>${product.availability}</g:availability>`,
    `      <g:condition>${product.condition}</g:condition>`,
    `      <g:brand>${escapeXml(product.brand)}</g:brand>`,
    `      <g:size>${escapeXml(product.size)}</g:size>`,
    `      <g:identifier_exists>${product.identifierExists ? "yes" : "no"}</g:identifier_exists>`,
    `      <g:shipping_label>${product.shippingLabel}</g:shipping_label>`,
    ...shippingXml(product, market),
    "    </item>",
  ].join("\n");
}

export function serializeGoogleMerchantFeed(input: Readonly<{
  market: Market;
  products: readonly MerchantProductData[];
  generatedAt: Date;
}>): string {
  const marketName = input.market === "NZ" ? "New Zealand" : "Australia";
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    "  <channel>",
    `    <title>R&amp;R Gallery ${marketName} Merchant Feed</title>`,
    "    <link>https://rnrgallery.com/</link>",
    "    <description>R&amp;R Gallery made-to-order products</description>",
    `    <lastBuildDate>${input.generatedAt.toUTCString()}</lastBuildDate>`,
    ...input.products.map((product) => itemXml(product, input.market)),
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

export function createGoogleMerchantFeedRoute(input: MerchantFeedRouteInput) {
  return {
    async GET(): Promise<Response> {
      try {
        const { registry } = await input.current();
        const products = buildMerchantProductData(registry, input.market, input.siteUrl);
        return new Response(serializeGoogleMerchantFeed({
          market: input.market,
          products,
          generatedAt: (input.now ?? (() => new Date()))(),
        }), { headers: xmlHeaders });
      } catch {
        return new Response("Merchant feed unavailable.", {
          status: 404,
          headers: unavailableHeaders,
        });
      }
    },
  };
}
