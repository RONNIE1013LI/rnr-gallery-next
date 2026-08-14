import Link from "next/link";
import { ProductionFieldManager } from "@/components/admin/production-field-manager";
import styles from "@/components/admin/admin.module.css";
import { getAdminProductionFieldRuntime } from "@/server/admin/admin-production-field-runtime";
import { requireAdminPage } from "@/server/auth/require-admin-page";

export const metadata = { title: "Production fields | R&R Gallery Admin" };

export default async function ProductionFieldsPage() {
  await requireAdminPage("/admin/jobs/fields", "manage_production_fields");
  const fields = await getAdminProductionFieldRuntime().list();
  return <section className={`${styles.pageSection} ${styles.narrowPage}`}>
    <header className={styles.pageHeader}>
      <div><nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><Link href="/admin/jobs">Production</Link><span>/</span><span>Form fields</span></nav><h1>Production form fields</h1><p>Manage optional studio fields without changing typed order, payment or production workflow data.</p></div>
    </header>
    <div className={styles.safetyBanner} role="note"><strong>Historical data is retained.</strong><p>Disable fields instead of deleting them. Field keys are immutable so imported eTeams values remain connected.</p></div>
    <ProductionFieldManager fields={fields.map((field) => ({ ...field, options: [...field.options], updatedAt: field.updatedAt.toISOString() }))} />
  </section>;
}
