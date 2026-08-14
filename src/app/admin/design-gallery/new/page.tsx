import { AdminGalleryForm } from "@/components/admin-gallery-form";
import Link from "next/link";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import styles from "@/components/admin/admin.module.css";

export const metadata = { title: "Add gallery design" };

export default async function NewAdminGalleryDesignPage() {
  await requireAdminPage("/admin/design-gallery/new", "manage_gallery");
  return (
    <section className={`${styles.pageSection} ${styles.narrowPage}`}>
      <header className={styles.pageHeader}>
        <div>
          <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><Link href="/admin/design-gallery">Design Gallery</Link><span>/</span><span>Add</span></nav>
          <h1>Add design</h1>
          <p>Add one approved image and classify it using the gallery’s existing taxonomy.</p>
        </div>
      </header>
      <AdminGalleryForm />
    </section>
  );
}
