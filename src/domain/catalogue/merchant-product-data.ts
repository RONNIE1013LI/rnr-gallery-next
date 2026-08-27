import { assertMarketCheckoutReady } from "./market-price-book";
import { schemaFromRegistry, type ProductRegistryDocument } from "./product-registry";
import type { Market, MarketCurrency } from "@/domain/markets/types";
import { quoteMarketConfiguration } from "@/domain/pricing/market-quote";

const MERCHANT_EXCLUDED_PRODUCT_KEYS = new Set(["banner-bundle"]);

export type MerchantProductData = Readonly<{
  id: string;
  productKey: string;
  sizeKey: string;
  itemGroupId: string;
  size: string;
  title: string;
  description: string;
  link: string;
  imageLink: string;
  currency: MarketCurrency;
  priceInclTaxCents: number;
  availability: "in_stock";
  brand: "R&R Gallery";
  condition: "new";
  identifierExists: false;
  shippingLabel: "NZ" | "AU";
}>;

export function buildMerchantProductData(
  registry: ProductRegistryDocument,
  market: Market,
  siteUrl: URL,
): readonly MerchantProductData[] {
  assertMarketCheckoutReady(registry, market);
  const book = registry.markets[market];
  const prefix = market === "AU" ? "/au" : "";

  return Object.freeze(registry.products.flatMap((product) => {
    if (!product.active || MERCHANT_EXCLUDED_PRODUCT_KEYS.has(product.key)) return [];
    const schema = schemaFromRegistry(registry, product.key);
    if (!schema) return [];
    return product.configuration.sizes.map((size) => {
      const price = quoteMarketConfiguration(registry, market, product.key, {
        sizeKey: size.key,
        peoplePets: schema.defaultPeoplePets,
      }).totalInclGstCents;
      return Object.freeze({
        id: `${market.toLowerCase()}:${product.key}:${size.key}`,
        productKey: product.key,
        sizeKey: size.key,
        itemGroupId: `${market.toLowerCase()}:${product.key}`,
        size: size.label,
        title: `${product.title} — ${size.label}`,
        description: product.summary,
        link: new URL(
          `${prefix}/products/${product.slug}?size=${encodeURIComponent(size.key)}`,
          siteUrl,
        ).toString(),
        imageLink: new URL(product.image.src, siteUrl).toString(),
        currency: book.currency,
        priceInclTaxCents: price,
        availability: "in_stock" as const,
        brand: "R&R Gallery" as const,
        condition: "new" as const,
        identifierExists: false as const,
        shippingLabel: market,
      });
    });
  }));
}
