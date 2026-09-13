import {
  ProductConfigurator,
  type ProductConfiguratorRelatedDesign,
} from "@/components/product-configurator";
import { BannerBundleConfigurator } from "@/components/banner-bundle-configurator";
import styles from "@/components/storefront.module.css";
import type {
  ProductRegistryDocument,
  ProductRegistryPricing,
} from "@/domain/catalogue/product-registry";
import type { Market } from "@/domain/markets/types";
import type { Product } from "@/domain/catalogue/types";
import type { ProductConfigurationSchema } from "@/domain/configuration/types";
import type { GalleryDesignSelection } from "@/server/gallery/design-selection-service";
import { AnalyticsEventTracker } from "@/components/analytics-event-tracker";
import { buildProductViewEvent } from "@/domain/analytics/events";
import { currencyForMarket } from "@/domain/markets/market";
import { quoteMarketConfiguration } from "@/domain/pricing/market-quote";

function buildConfigureViewEvent({
  product,
  schema,
  registry,
  market,
  sizeKey,
}: Readonly<{
  product: Product;
  schema: ProductConfigurationSchema;
  registry?: ProductRegistryDocument;
  market: Market;
  sizeKey: string;
}>) {
  if (!registry) return null;
  try {
    const quote = quoteMarketConfiguration(registry, market, product.key, {
      sizeKey,
      peoplePets: schema.defaultPeoplePets,
    });
    return buildProductViewEvent({
      productKey: product.key,
      productName: product.title,
      category: product.category,
      sizeKey,
      currency: currencyForMarket(market),
      unitSubtotalExTaxCents: quote.subtotalExGstCents,
    });
  } catch {
    return null;
  }
}

export function ConfigurePageContent({
  product,
  schema,
  pricing,
  registry,
  market = "NZ",
  orderDate,
  selectedDesign,
  relatedDesigns,
  initialSizeKey,
}: Readonly<{
  product: Product;
  schema: ProductConfigurationSchema;
  pricing: ProductRegistryPricing;
  registry?: ProductRegistryDocument;
  market?: Market;
  orderDate: string;
  selectedDesign: GalleryDesignSelection | null;
  relatedDesigns: readonly ProductConfiguratorRelatedDesign[];
  initialSizeKey?: string;
}>) {
  const sharedProps = {
    product,
    schema,
    pricing,
    registry,
    market,
    orderDate,
    selectedDesign,
    relatedDesigns,
    initialSizeKey,
  };
  const analyticsSizeKey = initialSizeKey ?? schema.defaultSizeKey;
  const analyticsEvent = buildConfigureViewEvent({
    product,
    schema,
    registry,
    market,
    sizeKey: analyticsSizeKey,
  });

  return (
    <main id="main-content" className={styles.configurePage}>
      <AnalyticsEventTracker
        event={analyticsEvent}
        scopeKey={`${market}:configure:${product.key}:${analyticsSizeKey}`}
      />
      <header className={styles.configureIntro}>
        <p className={styles.eyebrow}>Create your artwork</p>
        <h1>{product.title}</h1>
        <p>{product.summary}</p>
      </header>
      {product.key === "banner-bundle" ? (
        <BannerBundleConfigurator {...sharedProps} />
      ) : (
        <ProductConfigurator {...sharedProps} />
      )}
    </main>
  );
}
