import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { AnalyticsEventTracker } from "@/components/analytics-event-tracker";
import { StructuredData } from "@/components/structured-data";
import { notFound } from "next/navigation";
import styles from "@/components/storefront.module.css";
import { products } from "@/domain/catalogue/products";
import {
  getRegistryProductBySlug,
  schemaFromRegistry,
  type ProductRegistryDocument,
} from "@/domain/catalogue/product-registry";
import {
  quoteMarketConfiguration,
} from "@/domain/pricing/market-quote";
import { deliveryCopy } from "@/domain/content/delivery-copy";
import { getMarketCompleteness } from "@/domain/catalogue/market-price-book";
import { buildProductViewEvent } from "@/domain/analytics/events";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { addNzdGst, formatMarketMoney } from "@/domain/money";
import { currencyForMarket } from "@/domain/markets/market";
import type { Market } from "@/domain/markets/types";
import type { Product } from "@/domain/catalogue/types";
import type { GalleryDesignSelection } from "@/server/gallery/design-selection-service";
import { getGalleryRuntime } from "@/server/gallery/gallery-runtime";
import { getSiteUrl } from "@/server/seo/site-url";
import { buildBreadcrumbData, buildPublicMetadata } from "@/server/seo/metadata";

export type ProductPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    [key: string]: string | string[] | undefined;
    design?: string | string[];
    rnr_design?: string | string[];
    size?: string | string[];
  }>;
};

export const dynamicParams = false;
export const dynamic = "force-dynamic";

type ProductPagePresentation = Readonly<{
  title: string;
  summary: string;
  eyebrow: string;
  prioritizeMobileAction: boolean;
}>;

export function getProductPagePresentation(product: Product): ProductPagePresentation {
  if (product.key === "custom-themed-wall-banner") {
    return {
      title: "Custom Birthday & Event Wall Banner",
      summary: "Create a personalised birthday banner from your photos, names and wording, with custom artwork for parties, milestones and other celebrations.",
      eyebrow: "Birthday banners",
      prioritizeMobileAction: true,
    };
  }
  if (product.key === "digital-oil-painting-banner") {
    return {
      title: "Custom Memorial & Tribute Banner",
      summary: "A personalised memorial or funeral banner created from your photos and remembrance wording, with custom artwork or a painterly portrait style for a celebration of life.",
      eyebrow: "Memorial banners",
      prioritizeMobileAction: true,
    };
  }
  return {
    title: product.title,
    summary: product.summary,
    eyebrow: product.category,
    prioritizeMobileAction: false,
  };
}

export function generateStaticParams() {
  return products.map((product) => ({ slug: product.slug }));
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { registry } = await getSafePublicProductRegistry();
  const product = getRegistryProductBySlug(registry, (await params).slug);
  const presentation = product ? getProductPagePresentation(product) : undefined;
  return product
    ? buildPublicMetadata({
        title: presentation!.title,
        description: presentation!.summary,
        path: `/products/${product.slug}`,
        image: product.image.src,
        imageAlt: product.image.alt,
        includeMarketAlternates: registry.markets.AU.enabled && getMarketCompleteness(registry, "AU").ready,
      })
    : { title: "Product not found" };
}

export function ProductPageContent({
  product,
  selection,
  market = "NZ",
  priceInclTaxCents,
  analyticsSubtotalExGstCents,
  analyticsSizeKey,
  taxRegistered,
  selectedSizeKey,
  sizeLabels = [],
}: Readonly<{
  product: Product;
  selection: GalleryDesignSelection | null;
  market?: Market;
  priceInclTaxCents?: number;
  analyticsSubtotalExGstCents?: number;
  analyticsSizeKey?: string;
  taxRegistered?: boolean;
  selectedSizeKey?: string;
  sizeLabels?: readonly string[];
}>) {
  const presentation = getProductPagePresentation(product);
  const marketPrefix = market === "AU" ? "/au" : "";
  const configureParams = new URLSearchParams();
  if (selection) configureParams.set("design", selection.id);
  if (selectedSizeKey) configureParams.set("size", selectedSizeKey);
  const configureQuery = configureParams.toString();
  const configureHref = `${marketPrefix}/products/${product.slug}/configure${
    configureQuery ? `?${configureQuery}` : ""
  }`;
  const siteUrl = getSiteUrl();
  const productPath = `${marketPrefix}/products/${product.slug}`;
  const productUrl = new URL(productPath, siteUrl);
  if (selectedSizeKey) productUrl.searchParams.set("size", selectedSizeKey);
  const imageUrl = new URL(selection?.imageUrl ?? product.image.src, siteUrl).toString();
  const displayPrice = priceInclTaxCents ?? addNzdGst(product.startingPriceExGstCents);
  const currency = currencyForMarket(market);
  const taxLabel = market === "NZ" || taxRegistered ? " incl GST" : "";
  const deliverySummary = market === "NZ"
    ? [deliveryCopy.newZealand]
    : [
        deliveryCopy.australiaDhl,
        deliveryCopy.australiaStandard,
        deliveryCopy.australiaRemote,
      ];
  const media = (
    <div className={styles.productDetailMedia} data-product-media>
      <Image
        src={selection?.imageUrl ?? product.image.src}
        alt={selection?.altText ?? product.image.alt}
        fill
        loading="eager"
        priority
        sizes="(max-width: 820px) 100vw, 58vw"
      />
    </div>
  );
  const callToAction = (
    <Link className={styles.primaryButton} href={configureHref}>
      Start Your Design
    </Link>
  );
  const summary = (
    <div className={styles.productDetailSummary} data-product-summary>
      <p className={styles.eyebrow}>{presentation.eyebrow}</p>
      <h1>{presentation.title}</h1>
      {selection && (
        <div className={styles.selectedDesignNote}>
          <strong>Selected design inspiration</strong>
          <span>{selection.title}</span>
        </div>
      )}
      <p className={styles.productDetailLead}>{presentation.summary}</p>
      <p className={styles.productDetailPrice}>
        From {formatMarketMoney(displayPrice, currency)}{taxLabel}
      </p>
      {presentation.prioritizeMobileAction ? callToAction : null}
    </div>
  );
  const details = (
    <div className={styles.productDetailDetails} data-product-details>
      <section className={styles.productPurchaseDetails} aria-label="Product details">
        <p className={styles.productAvailability}>In stock</p>
        <h2>Available sizes</h2>
        <ul className={styles.productSizeList}>
          {sizeLabels.map((label) => <li key={label}>{label}</li>)}
        </ul>
        <h2>Production and delivery</h2>
        <p>{deliveryCopy.production}</p>
        <ul className={styles.productDeliveryList}>
          {deliverySummary.map((delivery) => <li key={delivery}>{delivery}</li>)}
        </ul>
        <ul className={styles.productAssurances}>
          <li>Proof before printing</li>
          <li>Two revisions included</li>
        </ul>
        <Link className={styles.productPolicyLink} href="/returns-refunds">
          Returns &amp; refunds
        </Link>
      </section>
      <ul className={styles.checkList}>
        <li>Choose the finished format and artwork details</li>
        <li>Upload now or provide your source photos after ordering</li>
        <li>Review a draft before production begins</li>
      </ul>
    </div>
  );
  const copy = (
    <div className={styles.productDetailCopy}>
      {summary}
      {details}
      {presentation.prioritizeMobileAction ? null : callToAction}
    </div>
  );
  return (
    <main id="main-content" className={styles.productDetail}>
      {analyticsSubtotalExGstCents !== undefined && analyticsSizeKey ? (
        <AnalyticsEventTracker
          event={buildProductViewEvent({
            productKey: product.key,
            productName: product.title,
            category: product.category,
            sizeKey: analyticsSizeKey,
            currency,
            unitSubtotalExTaxCents: analyticsSubtotalExGstCents,
          })}
          scopeKey={`${market}:${product.key}:${analyticsSizeKey}`}
        />
      ) : null}
      <StructuredData id="rnr-product-data" data={{
        "@context": "https://schema.org",
        "@type": "Product",
        name: presentation.title,
        description: presentation.summary,
        image: [imageUrl],
        brand: { "@type": "Brand", name: "R&R Gallery" },
        offers: {
          "@type": "Offer",
          url: productUrl.toString(),
          priceCurrency: currency,
          price: (displayPrice / 100).toFixed(2),
          availability: "https://schema.org/InStock",
          itemCondition: "https://schema.org/NewCondition",
        },
      }} />
      <StructuredData id="rnr-product-breadcrumbs" data={buildBreadcrumbData([
        { name: "Home", path: marketPrefix || "/" },
        { name: "Shop", path: market === "AU" ? "/au" : "/shop" },
        { name: presentation.title, path: productPath },
      ])} />
      <div className={`${styles.productDetailInner}${
        presentation.prioritizeMobileAction ? ` ${styles.productDetailIntentPage}` : ""
      }`}>
        {presentation.prioritizeMobileAction ? copy : media}
        {presentation.prioritizeMobileAction ? media : copy}
      </div>
    </main>
  );
}

export async function resolveProductPageSearchSelection(productSlug: string, searchParams: ProductPageProps["searchParams"]) {
  const resolved = await searchParams;
  const rawDesign = resolved.design ?? resolved.rnr_design;
  const designId = Array.isArray(rawDesign) ? rawDesign[0] : rawDesign;
  let selection: GalleryDesignSelection | null = null;
  try {
    selection = await getGalleryRuntime().selectionService.resolve(designId, productSlug);
  } catch {
    selection = null;
  }
  return { selection, designId };
}

export function resolveRequestedSizeKey(
  registry: ProductRegistryDocument,
  productKey: string,
  rawSize: string | string[] | undefined,
): string | undefined {
  const requested = Array.isArray(rawSize) ? rawSize[0] : rawSize;
  const schema = schemaFromRegistry(registry, productKey);
  return requested && schema?.sizes.some((size) => size.key === requested)
    ? requested
    : undefined;
}

export default async function ProductPage({ params, searchParams }: ProductPageProps) {
  const { registry } = await getSafePublicProductRegistry();
  const product = getRegistryProductBySlug(registry, (await params).slug);
  if (!product) notFound();
  const { selection } = await resolveProductPageSearchSelection(product.slug, searchParams);
  const resolvedSearchParams = await searchParams;
  const selectedSizeKey = resolveRequestedSizeKey(
    registry,
    product.key,
    resolvedSearchParams.size,
  );
  const schema = schemaFromRegistry(registry, product.key);
  if (!schema) notFound();
  const analyticsSizeKey = selectedSizeKey ?? schema.defaultSizeKey;
  const quote = quoteMarketConfiguration(registry, "NZ", product.key, {
    sizeKey: analyticsSizeKey,
    peoplePets: schema.defaultPeoplePets,
  });
  return (
    <ProductPageContent
      product={product}
      selection={selection}
      priceInclTaxCents={quote.totalInclGstCents}
      analyticsSubtotalExGstCents={quote.subtotalExGstCents}
      analyticsSizeKey={analyticsSizeKey}
      taxRegistered={registry.markets.NZ.tax.registered}
      selectedSizeKey={selectedSizeKey}
      sizeLabels={schema.sizes.map((size) => size.label)}
    />
  );
}
