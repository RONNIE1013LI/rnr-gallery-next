import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StructuredData } from "@/components/structured-data";
import styles from "@/components/storefront.module.css";
import {
  getRegistryProductBySlug,
} from "@/domain/catalogue/product-registry";
import {
  buildPublicDesignSlug,
  publicDesignTitle,
} from "@/domain/gallery/public-design-slug";
import { addNzdGst, formatNzdExplicit } from "@/domain/money";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { getGalleryRuntime } from "@/server/gallery/gallery-runtime";
import type { PublicGalleryItem } from "@/server/gallery/public-gallery-service";
import {
  buildBreadcrumbData,
  buildPublicMetadata,
} from "@/server/seo/metadata";

export const revalidate = 3600;

type Props = Readonly<{
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}>;

const productTypeLabels = {
  canvas: "Canvas",
  "grave-cover": "Grave cover",
  "roll-up-banner": "Roll-up banner",
  "wall-hanging-banners": "Wall banner",
} as const;

const productTypeMetadataLabels = {
  ...productTypeLabels,
  "grave-cover": "Grave Cover",
  "roll-up-banner": "Roll-up Banner",
  "wall-hanging-banners": "Wall Banner",
} as const;

const occasionLabels = {
  "baby-kids": "Baby / Kids",
  birthday: "Birthday",
  "business-promotion": "Business / Promotion",
  "family-portrait": "Family Portrait",
  "general-celebration": "General Celebration",
  graduation: "Graduation",
  memorial: "Memorial",
  "personalised-artwork": "Personalised Artwork",
  religious: "Religious",
  wedding: "Wedding",
} as const;

function scalar(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function safeGalleryReturnPath(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const base = new URL("https://rrgallery.co.nz");
    const parsed = new URL(value, base);
    if (parsed.origin !== base.origin || parsed.pathname !== "/design-gallery") return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

async function getDesign(slug: string): Promise<PublicGalleryItem | null> {
  try {
    return await getGalleryRuntime().publicService.findByPublicSlug(slug);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const design = await getDesign((await params).slug);
  if (!design) return { title: "Design not found", robots: { index: false, follow: false } };
  const title = publicDesignTitle(design);
  const productType = productTypeMetadataLabels[design.productTypeSlug];
  const slug = buildPublicDesignSlug(title, design.id);
  return buildPublicMetadata({
    title: `${title} ${productType} Design`,
    description: `Explore the ${title} ${productType.toLowerCase()} design and customise it with your own photos and wording at R&R Gallery.`,
    path: `/designs/${slug}`,
    image: `/gallery-images/${design.id}?v=${design.contentHash}`,
    imageAlt: design.altText,
  });
}

export default async function DesignDetailPage({ params, searchParams }: Props) {
  const [{ slug }, query, { registry }] = await Promise.all([
    params,
    searchParams,
    getSafePublicProductRegistry(),
  ]);
  const design = await getDesign(slug);
  if (!design) notFound();
  const product = getRegistryProductBySlug(registry, design.productSlug);
  const registryProduct = registry.products.find((candidate) => candidate.slug === design.productSlug);
  if (!product?.active || !registryProduct?.active) notFound();

  const title = publicDesignTitle(design);
  const canonicalSlug = buildPublicDesignSlug(title, design.id);
  const productType = productTypeLabels[design.productTypeSlug];
  const occasion = occasionLabels[design.occasionSlug];
  const priceInclGstCents = addNzdGst(product.startingPriceExGstCents);
  const returnTo = safeGalleryReturnPath(scalar(query.from))
    ?? `/design-gallery?occasion=${encodeURIComponent(design.occasionSlug)}&design_type=${encodeURIComponent(design.productTypeSlug)}`;
  let related: readonly PublicGalleryItem[] = [];
  try {
    const result = await getGalleryRuntime().publicService.list({
      page: 1,
      productTypes: [design.productTypeSlug],
      occasions: [design.occasionSlug],
      birthdayAges: [],
      themes: [],
    }, 5);
    related = result.items.filter((candidate) => candidate.id !== design.id).slice(0, 4);
  } catch {
    related = [];
  }

  return (
    <main id="main-content" className={styles.designDetailPage}>
      <StructuredData id="rnr-design-breadcrumbs" data={buildBreadcrumbData([
        { name: "Home", path: "/" },
        { name: "Design Gallery", path: "/design-gallery" },
        { name: title, path: `/designs/${canonicalSlug}` },
      ])} />
      <nav className={styles.publicBreadcrumbs} aria-label="Breadcrumb">
        <Link className={styles.breadcrumbHome} href="/">Home</Link>
        <span className={styles.breadcrumbSeparator} aria-hidden="true">›</span>
        <Link className={styles.breadcrumbGallery} href="/design-gallery">
          <span className={styles.breadcrumbBackIcon} aria-hidden="true">‹</span>
          Design Gallery
        </Link>
        <span className={styles.breadcrumbSeparator} aria-hidden="true">›</span>
        <span className={styles.breadcrumbCurrent} aria-current="page">{title}</span>
      </nav>
      <section className={styles.designDetailHero}>
        <div className={styles.designDetailMedia}>
          <Image
            src={`/gallery-images/${design.id}?v=${design.contentHash}`}
            alt={design.altText}
            width={design.width}
            height={design.height}
            priority
            sizes="(max-width: 820px) 100vw, 58vw"
          />
        </div>
        <div className={styles.designDetailCopy}>
          <p className={styles.eyebrow}>{productType} · {occasion}</p>
          <h1>{title}</h1>
          <p className={styles.productDetailLead}>
            A {productType.toLowerCase()} design that can be customised with your own photos and wording.
          </p>
          <dl className={styles.designDetailFacts}>
            <div><dt>Product type</dt><dd>{productType}</dd></div>
            <div><dt>Occasion</dt><dd>{occasion}</dd></div>
            <div><dt>Design image</dt><dd>{design.width} × {design.height} px</dd></div>
            <div>
              <dt>Available sizes</dt>
              <dd>{registryProduct.configuration.sizes.map((size) => size.label).join(", ")}</dd>
            </div>
          </dl>
          <p className={styles.productDetailPrice}>From {formatNzdExplicit(priceInclGstCents)} incl GST</p>
          <div className={styles.designDetailActions}>
            <Link className={styles.primaryButton} href={`/products/${product.slug}/configure?design=${design.id}`}>
              Use This Design
            </Link>
            <Link className={styles.secondaryButton} href={returnTo}>View Similar Designs</Link>
          </div>
        </div>
      </section>

      {related.length ? (
        <section className={styles.designRelated} aria-label="Related designs">
          <div className={styles.sectionHeading}><h2>Related designs</h2></div>
          <div className={styles.galleryGrid}>
            {related.map((item) => {
              const relatedTitle = publicDesignTitle(item);
              return (
                <article className={styles.galleryCard} key={item.id}>
                  <Link className={styles.galleryCardLink} href={`/designs/${buildPublicDesignSlug(relatedTitle, item.id)}`}>
                    <div className={styles.galleryCardMedia}>
                      <Image
                        src={`/gallery-images/${item.id}?v=${item.contentHash}`}
                        alt={item.altText}
                        width={item.width}
                        height={item.height}
                        loading="lazy"
                        sizes="(max-width: 767px) 50vw, 25vw"
                      />
                    </div>
                    <div className={styles.galleryCardBody}><h3>{relatedTitle}</h3></div>
                  </Link>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
    </main>
  );
}
