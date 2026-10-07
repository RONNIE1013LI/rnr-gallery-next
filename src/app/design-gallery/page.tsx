import { DesignGallery } from "@/components/design-gallery";
import { parseGalleryQuery } from "@/domain/gallery/query";
import { getGalleryRuntime } from "@/server/gallery/gallery-runtime";
import styles from "@/components/storefront.module.css";
import { buildPublicMetadata } from "@/server/seo/metadata";

type Props = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export async function generateMetadata({ searchParams }: Props) {
  const query = parseGalleryQuery(await searchParams);
  const filtered = query.productSlug || query.productTypes.length || query.occasions.length
    || query.birthdayAges.length || query.themes.length || query.showFilters;
  const page = filtered ? 1 : query.page;
  return buildPublicMetadata({
    title: page > 1 ? `Design gallery – Page ${page}` : "Design gallery",
    description: page > 1
      ? `Browse page ${page} of real R&R Gallery canvas, banner and memorial artwork for design inspiration.`
      : "Explore real R&R Gallery canvas, banner and memorial artwork for design inspiration.",
    path: page > 1 ? `/design-gallery?page=${page}` : "/design-gallery",
    image: "/media/home/homepage-signature-family-artwork-v2.webp",
    imageAlt: "Selection of completed personalised R&R Gallery designs",
  });
}

export default async function DesignGalleryPage({ searchParams }: Props) {
  const query = parseGalleryQuery(await searchParams);
  let result;
  try {
    result = await getGalleryRuntime().publicService.list(query);
  } catch {
    return (
      <main id="main-content" className={styles.galleryPage}>
        <section className={styles.galleryUnavailable}>
          <h1>The gallery is temporarily unavailable.</h1>
          <p>Please try again shortly or browse our products in the meantime.</p>
        </section>
      </main>
    );
  }
  return <DesignGallery query={query} result={result} />;
}
