import { DesignGallery } from "@/components/design-gallery";
import { parseGalleryQuery } from "@/domain/gallery/query";
import { getGalleryRuntime } from "@/server/gallery/gallery-runtime";
import styles from "@/components/storefront.module.css";
import { buildPublicMetadata } from "@/server/seo/metadata";

export const metadata = buildPublicMetadata({
  title: "Design gallery",
  description: "Explore real R&R Gallery canvas, banner and memorial artwork for design inspiration.",
  path: "/design-gallery",
  image: "/media/home/homepage-signature-family-artwork-v2.webp",
  imageAlt: "Selection of completed personalised R&R Gallery designs",
});

type Props = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

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
