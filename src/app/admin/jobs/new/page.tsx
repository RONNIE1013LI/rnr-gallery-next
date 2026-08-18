import Link from "next/link";
import { ProductionJobForm, type ProductionFormField } from "@/components/admin/production-job-form";
import styles from "@/components/admin/admin.module.css";
import { getAdminProductionRuntime } from "@/server/admin/admin-production-runtime";
import { hasAdminPermission } from "@/server/auth/admin-permissions";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { getRegistryProducts } from "@/domain/catalogue/product-registry";
import { getAdminProductionFieldRuntime } from "@/server/admin/admin-production-field-runtime";
import { getInvoiceBusinessSettings } from "@/server/invoices/invoice-business";

export const metadata = { title: "New manual job | R&R Gallery Admin" };

export default async function NewProductionJobPage() {
  const access = await requireAdminPage("/admin/jobs/new", "create_manual_jobs");
  const [assignees, { registry }, fieldDefinitions] = await Promise.all([
    getAdminProductionRuntime().assignees(),
    getSafePublicProductRegistry(),
    getAdminProductionFieldRuntime().list(),
  ]);
  const canManageFinance = hasAdminPermission(access.adminRole, access.adminPermissions, "update_production_finance");
  const canUploadFiles = hasAdminPermission(access.adminRole, access.adminPermissions, "upload_production_files");
  return (
    <section className={styles.pageSection}>
      <header className={styles.pageHeader}>
        <div><nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><Link href="/admin/jobs">Production</Link><span>/</span><span>New manual job</span></nav><h1>New manual job</h1><p>Record phone, Messenger, email, market and walk-in work without creating a false online order.</p></div>
      </header>
      <div className={styles.safetyBanner} role="note"><strong>Online orders are automatic.</strong><p>Use this form only for work received outside the website. Checkout totals and payment-provider records are never created here.</p></div>
      <ProductionJobForm
        assignees={assignees}
        canManageFinance={canManageFinance}
        canUploadFiles={canUploadFiles}
        backHref="/admin/jobs"
        submittedBy={access.user.email}
        productTitles={getRegistryProducts(registry).filter((product) => product.active).map((product) => product.title)}
        customFields={fieldDefinitions.filter((field) => field.enabled && field.showOnCreate && !field.legacyOnly && field.fieldType !== "file" && (field.section !== "finance" || canManageFinance)).map((field) => ({ id: field.id, label: field.label, fieldType: field.fieldType as ProductionFormField["fieldType"], options: field.options, required: field.required }))}
        invoiceBusiness={getInvoiceBusinessSettings()}
      />
    </section>
  );
}
