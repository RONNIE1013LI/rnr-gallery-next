import Link from "next/link";
import { EmailTemplateForm } from "@/components/admin/email-template-form";
import styles from "@/components/admin/admin.module.css";
import { getAdminContentRuntime } from "@/server/admin/admin-content-runtime";
import { hasAdminPermission } from "@/server/auth/admin-permissions";
import { requireAdminPage } from "@/server/auth/require-admin-page";

export const metadata = { title: "Email templates | R&R Gallery Admin" };

export default async function AdminEmailTemplatesPage() {
  const access = await requireAdminPage(
    "/admin/settings/email-templates",
    "manage_content",
  );
  const entries = await getAdminContentRuntime().listEmailTemplates();
  const canPublish = hasAdminPermission(access.adminRole, access.adminPermissions, "publish_content");

  return (
    <section className={styles.pageSection}>
      <header className={styles.pageHeader}>
        <div>
          <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
            <Link href="/admin">Dashboard</Link><span>/</span><span>Email templates</span>
          </nav>
          <h1>Email templates</h1>
          <p>Edit approved plain-text wording for automated order emails. Recipients, amounts and secure links remain controlled by the system.</p>
        </div>
      </header>
      {!canPublish ? <p className={styles.safetyBanner}>Staff can save drafts. An Admin must publish email changes.</p> : null}
      <EmailTemplateForm
        entries={entries}
        canPublish={canPublish}
        siteUrl={process.env.BETTER_AUTH_URL ?? "http://192.168.4.199:3000"}
      />
    </section>
  );
}
