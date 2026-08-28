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

function australiaShippingXml(product: MerchantProductData): readonly string[] {
  const rates = getAustraliaFixedShippingRates(product.productKey, product.sizeKey);
  return [
    "      <g:shipping>",
    "        <g:country>AU</g:country>",
    "        <g:service>Standard Shipping</g:service>",
    `        <g:price>${formatPrice(rates.standard, "AUD")}</g:price>`,
    "        <g:min_handling_time>5</g:min_handling_time>",
    "        <g:max_handling_time>5</g:max_handling_time>",
    "        <g:min_transit_time>7</g:min_transit_time>",
    "        <g:max_transit_time>14</g:max_transit_time>",
    "      </g:shipping>",
    "      <g:shipping>",
    "        <g:country>AU</g:country>",
    "        <g:service>DHL Express</g:service>",
    `        <g:price>${formatPrice(rates.dhlExpress, "AUD")}</g:price>`,
    "        <g:min_handling_time>5</g:min_handling_time>",
    "        <g:max_handling_time>5</g:max_handling_time>",
    "        <g:min_transit_time>2</g:min_transit_time>",
    "        <g:max_transit_time>14</g:max_transit_time>",
    "      </g:shipping>",
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
