import Image from "next/image";
import Link from "next/link";
import {
  galleryPageHref,
  type GalleryQuery,
} from "@/domain/gallery/query";
import {
  buildPublicDesignSlug,
  publicDesignTitle,
} from "@/domain/gallery/public-design-slug";
import { galleryThemes } from "@/domain/gallery/taxonomy";
import type { GalleryProductTypeSlug } from "@/domain/gallery/types";
import type { PublicGalleryItem } from "@/server/gallery/public-gallery-service";
import { DesignGalleryOccasionFilters } from "./design-gallery-occasion-filters";
import styles from "./storefront.module.css";

type GalleryResult = Readonly<{
  items: readonly PublicGalleryItem[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}>;

type Props = Readonly<{ query: GalleryQuery; result: GalleryResult }>;

const productTypeLabels: Readonly<Record<GalleryProductTypeSlug, string>> = {
  canvas: "Canvas",
  "grave-cover": "Grave covers",
  "roll-up-banner": "Roll-up banners",
  "wall-hanging-banners": "Wall banners",
};

const productTypeMobileLabels: Readonly<Record<GalleryProductTypeSlug, string>> = {
  canvas: "Canvas",
  "grave-cover": "Grave cover",
  "roll-up-banner": "Roll-up banner",
  "wall-hanging-banners": "Wall banner",
};

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

const themeLabels = {
  "colour-style": "Colour Style",
  "cultural-island": "Cultural / Island",
  "decoration-style": "Decoration Style",
  "kids-characters": "Kids / Characters",
  "religious-memorial": "Religious / Memorial",
} as const;

function quickHref(params: Array<[string, string]>): string {
  const search = new URLSearchParams(params);
  return `/design-gallery${search.size ? `?${search.toString()}` : ""}`;
}

function sameValues(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function FilterCheckbox({
  name,
  value,
  label,
  checked,
}: Readonly<{ name: string; value: string; label: string; checked: boolean }>) {
  return (
    <label className={styles.galleryCheckbox}>
      <input type="checkbox" name={name} value={value} defaultChecked={checked} />
      <span>{label}</span>
    </label>
  );
}

export function DesignGallery({ query, result }: Props) {
  const advancedOpen = query.showFilters || query.birthdayAges.length > 0 || query.themes.length > 0;
  const noSecondaryFilters = query.birthdayAges.length === 0 && query.themes.length === 0;
  const onlyOccasion = (occasion: string) => noSecondaryFilters
    && query.productTypes.length === 0
    && sameValues(query.occasions, [occasion]);
  const onlyProducts = (productTypes: readonly string[]) => noSecondaryFilters
    && query.occasions.length === 0
    && sameValues(query.productTypes, productTypes);
  const quickFilters = [
    ["All Designs", quickHref([]), noSecondaryFilters && query.productTypes.length === 0 && query.occasions.length === 0],
    ["Memorial", quickHref([["occasion", "memorial"]]), onlyOccasion("memorial")],
    ["Birthday", quickHref([["occasion", "birthday"]]), onlyOccasion("birthday")],
    ["Family", quickHref([["occasion", "family-portrait"]]), onlyOccasion("family-portrait")],
    ["Wedding", quickHref([["occasion", "wedding"]]), onlyOccasion("wedding")],
    ["Religious", quickHref([["occasion", "religious"]]), onlyOccasion("religious")],
    ["Canvas", quickHref([["design_type", "canvas"]]), onlyProducts(["canvas"])],
    ["Banners", quickHref([
      ["design_type", "grave-cover"],
      ["design_type", "roll-up-banner"],
      ["design_type", "wall-hanging-banners"],
    ]), onlyProducts(["grave-cover", "roll-up-banner", "wall-hanging-banners"])],
  ] as const;

  return (
    <main id="main-content" className={styles.galleryPage}>
      <header className={styles.galleryIntro}>
        <h1>Designed around your story.</h1>
        <p>Personalised artwork created for memorials, celebrations, families and life&apos;s most meaningful moments.</p>
      </header>

      <nav className={styles.galleryQuickFilters} aria-label="Design gallery filters">
        {quickFilters.map(([label, href, active]) => <Link aria-current={active ? "page" : undefined} key={label} href={href}>{label}</Link>)}
      </nav>

      <details id="browse-by-occasion" className={styles.galleryFilters} open={advancedOpen}>
        <summary>Filters +</summary>
        <form action="/design-gallery" method="get">
          <fieldset>
            <legend>Product Type</legend>
            {(Object.keys(productTypeLabels) as GalleryProductTypeSlug[]).map((value) => (
              <FilterCheckbox key={value} name="design_type" value={value} label={productTypeLabels[value]} checked={query.productTypes.includes(value)} />
            ))}
          </fieldset>
          <DesignGalleryOccasionFilters
            key={`${query.occasions.join(",")}:${query.birthdayAges.join(",")}`}
            selectedOccasions={query.occasions}
            selectedBirthdayAges={query.birthdayAges}
          />
          <fieldset>
            <legend>Theme</legend>
            {galleryThemes.map((value) => (
              <FilterCheckbox key={value} name="theme" value={value} label={themeLabels[value]} checked={query.themes.includes(value)} />
            ))}
          </fieldset>
          <div className={styles.galleryFilterActions}>
            <button className={styles.primaryButton} type="submit">Apply filters</button>
            <Link href="/design-gallery">Clear all filters</Link>
          </div>
        </form>
      </details>

      <div className={styles.galleryResultHeader} aria-live="polite">
        <span>{result.total} artworks</span>
      </div>

      {result.items.length > 0 ? (
        <section className={styles.galleryGrid} aria-label="Design gallery artworks">
          {result.items.map((item, index) => {
            const title = item.subOccasion ?? occasionLabels[item.occasionSlug];
            const publicSlug = buildPublicDesignSlug(publicDesignTitle(item), item.id);
            const returnTo = galleryPageHref(query, result.page);
            const mobileSpan = item.productTypeSlug === "wall-hanging-banners" ? "wide" : "compact";
            return (
              <article
                className={styles.galleryCard}
                data-gallery-mobile-span={mobileSpan}
                key={item.id}
              >
                <Link
                  className={styles.galleryCardLink}
                  href={`/designs/${publicSlug}?from=${encodeURIComponent(returnTo)}`}
                >
                  <div className={styles.galleryCardMedia}>
                    <Image
                      src={`/gallery-images/${item.id}?v=${item.contentHash}`}
                      alt={item.altText}
                      width={item.width}
                      height={item.height}
                      loading={index < 3 ? "eager" : "lazy"}
                      fetchPriority={index < 3 ? "high" : "auto"}
                      sizes={mobileSpan === "wide"
                        ? "(max-width: 767px) calc(100vw - 2rem), (max-width: 1179px) 45vw, (max-width: 1567px) 29.34vw, 459px"
                        : "(max-width: 767px) calc((100vw - 2.75rem) / 2), (max-width: 1179px) 45vw, (max-width: 1567px) 29.34vw, 459px"}
                    />
                    <span className={styles.galleryCardBadge}>
                      {productTypeMobileLabels[item.productTypeSlug]}
                    </span>
                  </div>
                  <div className={styles.galleryCardBody}>
                    <h2>{title}</h2>
                    <p>{occasionLabels[item.occasionSlug]} · {productTypeLabels[item.productTypeSlug]}</p>
                    <span className={styles.galleryCardAction}>View design</span>
                  </div>
                </Link>
              </article>
            );
          })}
        </section>
      ) : (
        <section className={styles.galleryEmpty}>
          <h2>No designs match these filters.</h2>
          <p>Clear the filters to browse the full collection.</p>
          <Link className={styles.primaryButton} href="/design-gallery">Browse all designs</Link>
        </section>
      )}

      {result.pageCount > 1 && (
        <nav className={styles.galleryPagination} aria-label="Gallery pages">
          {result.page > 1 && <Link href={galleryPageHref(query, result.page - 1)}>Previous page</Link>}
          <span>Page {result.page} of {result.pageCount}</span>
          {result.page < result.pageCount && <Link href={galleryPageHref(query, result.page + 1)}>Next page</Link>}
        </nav>
      )}
    </main>
  );
}
