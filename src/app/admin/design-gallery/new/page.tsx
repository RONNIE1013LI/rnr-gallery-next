import { AdminGalleryForm } from "@/components/admin-gallery-form";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import styles from "@/components/storefront.module.css";

export const metadata = { title: "Add gallery design" };

export default async function NewAdminGalleryDesignPage() {
  await requireAdminPage();
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
