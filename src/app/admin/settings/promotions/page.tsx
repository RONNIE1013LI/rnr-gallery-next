import type { Metadata } from "next";
import Link from "next/link";
import { PromotionSettingsForm } from "@/components/admin/promotion-settings-form";
import styles from "@/components/admin/admin.module.css";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { getThankYouOfferState } from "@/server/promotions/thank-you-offer-state";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Promotions | R&R Gallery Admin" };

export default async function AdminPromotionsSettingsPage() {
  await requireAdminPage("/admin/settings/promotions", "manage_content");
  await requireAdminPage("/admin/settings/promotions", "publish_content");
  let enabled: boolean | null = null;
  try {
    enabled = await getThankYouOfferState();
  } catch {
    // A failed authoritative read must not offer a guessed state for publishing.
  }

  return (
    <section className={`${styles.pageSection} ${styles.narrowPage}`}>
      <header className={styles.pageHeader}>
        <div>
          <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
            <Link href="/admin">Dashboard</Link><span>/</span><Link href="/admin/settings">Settings</Link><span>/</span><span>Promotions</span>
          </nav>
          <h1>Promotions</h1>
          <p>Control the anniversary thank-you offer campaign.</p>
        </div>
      </header>
      {enabled === null ? (
        <div className={styles.panel} role="alert">
          Promotion setting is unavailable. Reload this page to try again before making changes.
        </div>
      ) : <PromotionSettingsForm initialEnabled={enabled} />}
    </section>
  );
}
