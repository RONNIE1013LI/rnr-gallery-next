import type { Metadata } from "next";
import { DesignGallery } from "@/components/design-gallery";
import { parseGalleryQuery } from "@/domain/gallery/query";
import { getGalleryRuntime } from "@/server/gallery/gallery-runtime";
import styles from "@/components/storefront.module.css";

export const metadata: Metadata = { title: "Design gallery" };

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
          <p className={styles.eyebrow}>Design gallery</p>
          <h1>The gallery is temporarily unavailable.</h1>
          <p>Please try again shortly or browse our products in the meantime.</p>
        </section>
      </main>
    );
  }
  return <DesignGallery query={query} result={result} />;
}
