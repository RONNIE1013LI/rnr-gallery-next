import type { Metadata } from "next";
import Link from "next/link";
import { AdvertisingSettingsForm } from "@/components/admin/advertising-settings-form";
import styles from "@/components/admin/admin.module.css";
import { getAdminContentRuntime } from "@/server/admin/admin-content-runtime";
import { requireAdminPage } from "@/server/auth/require-admin-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Advertising tracking | R&R Gallery Admin" };

export default async function AdminAdvertisingSettingsPage() {
  await requireAdminPage("/admin/settings/advertising", "publish_content");
  const content = await getAdminContentRuntime().public(["advertising.meta.enabled"]);

  return (
    <section className={`${styles.pageSection} ${styles.narrowPage}`}>
      <header className={styles.pageHeader}>
        <div>
          <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
            <Link href="/admin">Dashboard</Link><span>/</span><span>Advertising tracking</span>
          </nav>
          <h1>Advertising tracking</h1>
          <p>Production measurement controls. This page does not publish or change Meta advertising campaigns.</p>
        </div>
      </header>
      <AdvertisingSettingsForm initialEnabled={content["advertising.meta.enabled"] === "enabled"} />
    </section>
  );
}
