import { notFound } from "next/navigation";
import Link from "next/link";
import { AdminGalleryForm, type AdminGalleryFormDesign } from "@/components/admin-gallery-form";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { getAdminGalleryService } from "@/server/gallery/admin-gallery-runtime";
import styles from "@/components/admin/admin.module.css";

type Props = Readonly<{ params: Promise<{ designId: string }> }>;

export const metadata = { title: "Edit gallery design" };
export const dynamic = "force-dynamic";

export default async function EditAdminGalleryDesignPage({ params }: Props) {
  const { designId } = await params;
  await requireAdminPage(`/admin/design-gallery/${encodeURIComponent(designId)}`, "manage_gallery");
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
    <section className={`${styles.pageSection} ${styles.narrowPage}`}>
      <header className={styles.pageHeader}>
        <div>
          <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><Link href="/admin/design-gallery">Design Gallery</Link><span>/</span><span>Edit</span></nav>
          <h1>Edit design</h1>
          <p>Changes are recorded before the public design is updated.</p>
        </div>
      </header>
      <AdminGalleryForm design={design} />
    </section>
  );
}
