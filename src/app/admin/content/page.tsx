import Link from "next/link";
import { AdminContentForm } from "@/components/admin/content-form";
import styles from "@/components/admin/admin.module.css";
import { getAdminContentRuntime } from "@/server/admin/admin-content-runtime";
import { requireAdminPage } from "@/server/auth/require-admin-page";

export const metadata = { title: "Content | R&R Gallery Admin" };

export default async function AdminContentPage() {
  const access = await requireAdminPage("/admin/content", "manage_content");
  const entries = await getAdminContentRuntime().list();
  const canPublish = access.adminRole === "admin";

  return (
    <section className={styles.pageSection}>
      <header className={styles.pageHeader}>
        <div>
          <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><span>Content</span></nav>
          <h1>Content</h1>
          <p>Manage approved plain-text business content. HTML, scripts and arbitrary code are not accepted.</p>
        </div>
      </header>
      {!canPublish ? <p className={styles.safetyBanner}>Staff can save drafts. An Admin must publish storefront changes.</p> : null}
      <AdminContentForm entries={entries} canPublish={canPublish} />
    </section>
  );
}
