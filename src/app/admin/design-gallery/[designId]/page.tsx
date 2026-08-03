import { notFound } from "next/navigation";
import { AdminGalleryForm, type AdminGalleryFormDesign } from "@/components/admin-gallery-form";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { getAdminGalleryService } from "@/server/gallery/admin-gallery-runtime";
import styles from "@/components/storefront.module.css";

type Props = Readonly<{ params: Promise<{ designId: string }> }>;

export const metadata = { title: "Edit gallery design" };

export default async function EditAdminGalleryDesignPage({ params }: Props) {
  await requireAdminPage();
  const { designId } = await params;
  const record = await getAdminGalleryService().get(designId);
  if (!record) notFound();
  const design: AdminGalleryFormDesign = {
    id: String(record.id),
    altText: String(record.altText),
    imageUrl: String(record.imageUrl),
    productTypeSlug: record.productTypeSlug as AdminGalleryFormDesign["productTypeSlug"],
    occasionSlug: String(record.occasionSlug),
    subOccasion: typeof record.subOccasion === "string" ? record.subOccasion : null,
    themeSlugs: Array.isArray(record.themeSlugs) ? record.themeSlugs.map(String) : [],
    productSlug: String(record.productSlug),
    status: record.status === "trashed" ? "trashed" : "active",
  };

  return (
    <section className={styles.adminSectionNarrow}>
      <header className={styles.adminHeading}>
        <div>
          <p className={styles.eyebrow}>Design Gallery</p>
          <h1>Edit design</h1>
          <p>Changes are recorded before the public design is updated.</p>
        </div>
      </header>
      <AdminGalleryForm design={design} />
    </section>
  );
}
