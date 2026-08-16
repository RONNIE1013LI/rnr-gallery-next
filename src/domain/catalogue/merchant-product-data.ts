import { assertMarketCheckoutReady } from "./market-price-book";
import type { ProductRegistryDocument } from "./product-registry";
import type { Market, MarketCurrency } from "@/domain/markets/types";

export type MerchantProductData = Readonly<{
  id: string;
  productKey: string;
  sizeKey: string;
  title: string;
  description: string;
  link: string;
  imageLink: string;
  currency: MarketCurrency;
  priceInclTaxCents: number;
  availability: "in_stock";
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
    if (!product.active) return [];
    const prices = book.products.find((entry) => entry.productKey === product.key);
    if (!prices) return [];
    return product.configuration.sizes.map((size) => {
      const price = prices.sizes.find((entry) => entry.sizeKey === size.key)
        ?.amountInclTaxCents;
      if (price === null || price === undefined) {
        throw new Error(`Merchant price is missing for ${market}:${product.key}:${size.key}.`);
      }
      return Object.freeze({
        id: `${market.toLowerCase()}:${product.key}:${size.key}`,
        productKey: product.key,
        sizeKey: size.key,
        title: `${product.title} — ${size.label}`,
        description: product.summary,
        link: new URL(`${prefix}/products/${product.slug}`, siteUrl).toString(),
        imageLink: new URL(product.image.src, siteUrl).toString(),
        currency: book.currency,
        priceInclTaxCents: price,
        availability: "in_stock" as const,
      });
    });
  }));
}
