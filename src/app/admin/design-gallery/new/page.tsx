import { AdminGalleryForm } from "@/components/admin-gallery-form";
import { requireAdmin } from "@/server/auth/require-admin";
import styles from "@/components/storefront.module.css";

export const metadata = { title: "Add gallery design" };

export default async function NewAdminGalleryDesignPage() {
  await requireAdmin();
  return (
    <section className={styles.adminSectionNarrow}>
      <header className={styles.adminHeading}>
        <div>
          <p className={styles.eyebrow}>Design Gallery</p>
          <h1>Add design</h1>
          <p>Add one approved image and classify it using the gallery’s existing taxonomy.</p>
        </div>
      </header>
      <AdminGalleryForm />
    </section>
  );
}
