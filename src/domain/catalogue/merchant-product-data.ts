import { assertMarketCheckoutReady } from "./market-price-book";
import { schemaFromRegistry, type ProductRegistryDocument } from "./product-registry";
import type { Market, MarketCurrency } from "@/domain/markets/types";
import { quoteMarketConfiguration } from "@/domain/pricing/market-quote";

const MERCHANT_EXCLUDED_PRODUCT_KEYS = new Set(["banner-bundle"]);
const MERCHANT_ADVERTISING_SAFE_IMAGE_PATH =
  "/media/home/homepage-begin-product-formats-v2.webp";

export const MERCHANT_ADVERTISING_SAFE_IMAGE_BY_PRODUCT_KEY = Object.freeze({
  "photo-print-canvas": MERCHANT_ADVERTISING_SAFE_IMAGE_PATH,
  "digital-oil-painting-canvas": MERCHANT_ADVERTISING_SAFE_IMAGE_PATH,
  "custom-themed-canvas": MERCHANT_ADVERTISING_SAFE_IMAGE_PATH,
  "roll-up-banner": MERCHANT_ADVERTISING_SAFE_IMAGE_PATH,
  "custom-themed-wall-banner": MERCHANT_ADVERTISING_SAFE_IMAGE_PATH,
  "digital-oil-painting-banner": MERCHANT_ADVERTISING_SAFE_IMAGE_PATH,
});

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
    const imagePath = MERCHANT_ADVERTISING_SAFE_IMAGE_BY_PRODUCT_KEY[
      product.key as keyof typeof MERCHANT_ADVERTISING_SAFE_IMAGE_BY_PRODUCT_KEY
    ];
    if (!product.active || MERCHANT_EXCLUDED_PRODUCT_KEYS.has(product.key) || !imagePath) {
      return [];
    }
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
        imageLink: new URL(imagePath, siteUrl).toString(),
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
