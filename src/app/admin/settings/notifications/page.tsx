import type { Metadata } from "next";
import Link from "next/link";
import { InternalNotificationSettings } from "@/components/admin/internal-notification-settings";
import styles from "@/components/admin/admin.module.css";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { getInternalNotificationRecipientRuntime } from "@/server/notifications/internal-notification-recipient-runtime";
import {
  INTERNAL_NOTIFICATION_TOPICS,
  type InternalNotificationTopic,
} from "@/server/notifications/internal-notification-types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Notification emails | R&R Gallery Admin",
};

export default async function AdminNotificationSettingsPage() {
  await requireAdminPage("/admin/settings/notifications", "manage_roles");
  const recipients = await getInternalNotificationRecipientRuntime().list();
  const coverage = Object.fromEntries(
    INTERNAL_NOTIFICATION_TOPICS.map((topic) => [topic, 0]),
  ) as Record<InternalNotificationTopic, number>;

  for (const recipient of recipients) {
    if (recipient.status !== "active") continue;
    for (const topic of recipient.topics) coverage[topic] += 1;
  }

  return (
    <section className={styles.pageSection}>
      <header className={styles.pageHeader}>
        <div>
          <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
            <Link href="/admin">Dashboard</Link><span>/</span><span>Notification emails</span>
          </nav>
          <h1>Notification emails</h1>
          <p>Add verified internal recipients and choose which operational events each email receives.</p>
        </div>
      </header>
      <InternalNotificationSettings recipients={recipients} coverage={coverage} />
    </section>
  );
}
