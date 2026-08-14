import Link from "next/link";
import { AdminGalleryList, type AdminGalleryListItem } from "@/components/admin-gallery-list";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { getAdminGalleryService } from "@/server/gallery/admin-gallery-runtime";
import styles from "@/components/admin/admin.module.css";

export const metadata = { title: "Manage Design Gallery" };
export const dynamic = "force-dynamic";

export default async function AdminGalleryPage() {
  await requireAdminPage("/admin/design-gallery", "manage_gallery");
  const records = await getAdminGalleryService().list();
  const designs = records.map((record) => ({
    id: String(record.id),
    altText: String(record.altText),
    imageUrl: String(record.imageUrl),
    productTypeSlug: String(record.productTypeSlug),
    occasionSlug: String(record.occasionSlug),
    subOccasion: typeof record.subOccasion === "string" ? record.subOccasion : null,
    productSlug: String(record.productSlug),
    status: record.status === "trashed" ? "trashed" as const : "active" as const,
  } satisfies AdminGalleryListItem));

  return (
    <section className={styles.pageSection}>
      <header className={styles.pageHeader}>
        <div>
          <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><span>Design Gallery</span></nav>
          <h1>Design Gallery management</h1>
          <p>{designs.length} designs. Edit classifications, replace artwork, or remove a design from the public gallery.</p>
        </div>
        <Link className={styles.primaryAdminButton} href="/admin/design-gallery/new">Add design</Link>
      </header>
      <AdminGalleryList designs={designs} />
    </section>
  );
}
