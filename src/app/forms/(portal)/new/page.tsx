import Link from "next/link";

import { ProductionJobForm, type ProductionFormField } from "@/components/admin/production-job-form";
import styles from "@/components/forms/forms.module.css";
import { getRegistryProducts } from "@/domain/catalogue/product-registry";
import { getAdminProductionFieldRuntime } from "@/server/admin/admin-production-field-runtime";
import { getAdminProductionRuntime } from "@/server/admin/admin-production-runtime";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { hasFormPermission } from "@/server/forms/forms-permissions";
import { requireFormsPage } from "@/server/forms/require-forms-page";
import { getInvoiceBusinessSettings } from "@/server/invoices/invoice-business";

export const metadata = { title: "Order entry" };

export default async function NewFormsJobPage() {
  const access = await requireFormsPage("/order-system/new", "create_jobs");
  const [assignees, { registry }, fields] = await Promise.all([
    getAdminProductionRuntime().assignees(),
    getSafePublicProductRegistry(),
    getAdminProductionFieldRuntime().list(),
  ]);
  const canManageFinance = hasFormPermission(access.formRole, access.formProfile, "update_finance");
  const canUploadFiles = hasFormPermission(access.formRole, access.formProfile, "upload_files");
  return (
    <section className={styles.formsPage}>
      <header className={styles.formsPageHeader}>
        <div>
          <nav aria-label="Breadcrumb"><Link href="/order-system">Data list</Link><span>/</span><span>Order entry</span></nav>
          <h1>Order entry</h1>
          <p>Record phone, Messenger, email, market and walk-in work using the same studio fields.</p>
        </div>
      </header>
      <div className={styles.formsSafetyNote} role="note">
        <strong>Website orders are recorded automatically.</strong>
        <p>Use manual entry only for work received outside online checkout.</p>
      </div>
      <div className={styles.formEntryPage}>
        <ProductionJobForm
          assignees={assignees}
          canManageFinance={canManageFinance}
          canUploadFiles={canUploadFiles}
          endpoint="/api/forms/jobs"
          detailBasePath="/order-system/jobs"
          backHref="/order-system"
          submittedBy={access.user.name?.trim() || "Current operator"}
          manualEntryLayout
          productTitles={getRegistryProducts(registry).filter((product) => product.active).map((product) => product.title)}
          customFields={fields.filter((field) =>
            field.enabled && field.showOnCreate && !field.legacyOnly && field.fieldType !== "file" &&
            (field.section !== "finance" || canManageFinance)
          ).map((field) => ({
            id: field.id,
            label: field.label,
            fieldType: field.fieldType as ProductionFormField["fieldType"],
            options: field.options,
            required: field.required,
          }))}
          invoiceBusiness={getInvoiceBusinessSettings()}
        />
      </div>
    </section>
  );
}
