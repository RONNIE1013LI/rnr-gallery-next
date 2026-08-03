import Image from "next/image";
import Link from "next/link";
import {
  galleryBirthdayAges,
  galleryPageHref,
  type GalleryQuery,
} from "@/domain/gallery/query";
import { galleryOccasions, galleryThemes } from "@/domain/gallery/taxonomy";
import type { GalleryProductTypeSlug } from "@/domain/gallery/types";
import type { PublicGalleryItem } from "@/server/gallery/public-gallery-service";
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
  const advancedOpen = query.birthdayAges.length > 0 || query.themes.length > 0;
  const quickFilters = [
    ["All Designs", quickHref([])],
    ["Memorial", quickHref([["occasion", "memorial"]])],
    ["Birthday", quickHref([["occasion", "birthday"]])],
    ["Family", quickHref([["occasion", "family-portrait"]])],
    ["Wedding", quickHref([["occasion", "wedding"]])],
    ["Religious", quickHref([["occasion", "religious"]])],
    ["Canvas", quickHref([["design_type", "canvas"]])],
    ["Banners", quickHref([
      ["design_type", "grave-cover"],
      ["design_type", "roll-up-banner"],
      ["design_type", "wall-hanging-banners"],
    ])],
  ] as const;

  return (
    <main id="main-content" className={styles.galleryPage}>
      <header className={styles.galleryIntro}>
        <p className={styles.eyebrow}>Our work</p>
        <h1>Designed around your story.</h1>
        <p>Personalised artwork created for memorials, celebrations, families and life&apos;s most meaningful moments.</p>
      </header>

      <nav className={styles.galleryQuickFilters} aria-label="Design gallery filters">
        {quickFilters.map(([label, href]) => <Link key={label} href={href}>{label}</Link>)}
      </nav>

      <details className={styles.galleryFilters} open={advancedOpen}>
        <summary>Filters +</summary>
        <form action="/design-gallery" method="get">
          <fieldset>
            <legend>Product Type</legend>
            {(Object.keys(productTypeLabels) as GalleryProductTypeSlug[]).map((value) => (
              <FilterCheckbox key={value} name="design_type" value={value} label={productTypeLabels[value]} checked={query.productTypes.includes(value)} />
            ))}
          </fieldset>
          <fieldset>
            <legend>Occasion</legend>
            {galleryOccasions.map((value) => (
              <FilterCheckbox key={value} name="occasion" value={value} label={occasionLabels[value]} checked={query.occasions.includes(value)} />
            ))}
          </fieldset>
          {query.occasions.includes("birthday") && (
            <fieldset>
              <legend>Birthday age</legend>
              {galleryBirthdayAges.map((value) => (
                <FilterCheckbox key={value} name="birthday_age" value={value} label={value} checked={query.birthdayAges.includes(value)} />
              ))}
            </fieldset>
          )}
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
          {result.items.map((item) => {
            const title = item.subOccasion ?? occasionLabels[item.occasionSlug];
            return (
              <article className={styles.galleryCard} key={item.id}>
                <Image
                  src={`/gallery-images/${item.id}?v=${item.contentHash}`}
                  alt={item.altText}
                  width={item.width}
                  height={item.height}
                  sizes="(max-width: 767px) 100vw, (max-width: 1179px) 50vw, 33vw"
                  unoptimized
                />
                <div className={styles.galleryCardBody}>
                  <h2>{title}</h2>
                  <p>{occasionLabels[item.occasionSlug]} · {productTypeLabels[item.productTypeSlug]}</p>
                  <Link href={`/products/${item.productSlug}?design=${item.id}`}>
                    View {item.altText}
                  </Link>
                </div>
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
