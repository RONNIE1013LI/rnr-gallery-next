import { FormsWorkbench, type FormsOrderEntryData } from "@/components/forms/forms-workbench";
import type { ProductionFormField } from "@/components/admin/production-job-form";
import { getRegistryProducts } from "@/domain/catalogue/product-registry";
import { getAdminProductionFieldRuntime } from "@/server/admin/admin-production-field-runtime";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { getDatabase } from "@/server/db/client";
import { listFormOrders } from "@/server/forms/drizzle-forms-workbench-repository";
import { hasFormPermission } from "@/server/forms/forms-permissions";
import { parseFormWorkbenchQuery } from "@/server/forms/forms-workbench-service";
import { requireFormsPage } from "@/server/forms/require-forms-page";
import { getFormsSavedViewRuntime } from "@/server/forms/forms-saved-view-runtime";
import { listProductionAssignees } from "@/server/production/drizzle-production-job-repository";
import { getInvoiceBusinessSettings } from "@/server/invoices/invoice-business";

type Props = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export const metadata = { title: "Data list" };

function queryString(values: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams();
  for (const [key, raw] of Object.entries(values)) {
    const entries = Array.isArray(raw) ? raw : [raw];
    for (const value of entries) {
      if (value) query.append(key, value);
    }
  }
  return query.toString();
}

export default async function FormsDataListPage({ searchParams }: Props) {
  const raw = await searchParams;
  const currentQuery = queryString(raw);
  const access = await requireFormsPage(
    `/order-system${currentQuery ? `?${currentQuery}` : ""}`,
    "view_jobs",
  );
  const query = parseFormWorkbenchQuery(raw);
  const canViewFinance = hasFormPermission(
    access.formRole,
    access.formProfile,
    "view_finance",
  );
  const canViewCustomerContact = hasFormPermission(access.formRole, access.formProfile, "view_customer_contact");
  const canViewPaymentProof = hasFormPermission(access.formRole, access.formProfile, "view_payment_proof");
  const canManageViews = hasFormPermission(access.formRole, access.formProfile, "manage_views");
  const canUpdate = hasFormPermission(access.formRole, access.formProfile, "update_jobs");
  const canCreate = hasFormPermission(access.formRole, access.formProfile, "create_jobs");
  const canUpdateFinance = hasFormPermission(access.formRole, access.formProfile, "update_finance");
  const canViewFiles = hasFormPermission(access.formRole, access.formProfile, "view_files");
  const canUploadFiles = hasFormPermission(access.formRole, access.formProfile, "upload_files");
  const entryRequested = raw.entry === "new" && canCreate;
  const [result, savedViews, assignees, configuredFields, productRegistry] = await Promise.all([
    listFormOrders(getDatabase(), query, {
      actorUserId: access.user.id,
      assignedOnly: access.formProfile?.assignedOnly ?? false,
      canViewCustomerContact,
      canViewFinance,
      canViewPaymentProof,
    }),
    canManageViews
      ? getFormsSavedViewRuntime().list({
          userId: access.user.id,
          email: access.user.email ?? "unknown@invalid.local",
        })
      : Promise.resolve([]),
    listProductionAssignees(getDatabase()),
    getAdminProductionFieldRuntime().list(),
    entryRequested ? getSafePublicProductRegistry() : Promise.resolve(null),
  ]);
  const editableAssignees = canUpdate || entryRequested ? assignees : [];
  const orderEntry: FormsOrderEntryData | undefined = productRegistry ? {
    assignees: editableAssignees,
    canManageFinance: canUpdateFinance,
    canUploadFiles,
    submittedBy: access.user.name?.trim() || "Current operator",
    productTitles: getRegistryProducts(productRegistry.registry)
      .filter((product) => product.active)
      .map((product) => product.title),
    customFields: configuredFields.filter((field) =>
      field.enabled && field.showOnCreate && !field.legacyOnly && field.fieldType !== "file" &&
      (field.section !== "finance" || canUpdateFinance)
    ).map((field) => ({
      id: field.id,
      label: field.label,
      fieldType: field.fieldType as ProductionFormField["fieldType"],
      options: field.options,
      required: field.required,
    })),
    invoiceBusiness: getInvoiceBusinessSettings(),
  } : undefined;
  return (
    <FormsWorkbench
      result={result}
      query={query}
      canExport={hasFormPermission(access.formRole, access.formProfile, "export_jobs")}
      canViewFinance={canViewFinance}
      canViewCustomerContact={canViewCustomerContact}
      canViewPaymentProof={canViewPaymentProof}
      filterCustomFields={configuredFields.filter((field) =>
        field.enabled && !field.legacyOnly && field.fieldType !== "file" &&
        (field.section !== "finance" || canViewFinance) &&
        (field.section !== "customer" || canViewCustomerContact)
      ).map((field) => ({
        id: field.id,
        label: field.label,
        fieldType: field.fieldType as "text" | "textarea" | "number" | "date" | "select" | "radio",
        options: field.options,
        section: field.section,
      }))}
      filterPeople={assignees.map(({ id, name }) => ({ id, name }))}
      canManageViews={canManageViews}
      savedViews={savedViews}
      canUpdate={canUpdate}
      canUpdateFinance={canUpdateFinance}
      canUpdateProductionStatus={hasFormPermission(access.formRole, access.formProfile, "update_production_status")}
      canUpdateDeliveryStatus={hasFormPermission(access.formRole, access.formProfile, "update_delivery_status")}
      canViewFiles={canViewFiles}
      canUploadFiles={canUploadFiles}
      canReviewProofs={hasFormPermission(access.formRole, access.formProfile, "update_production_status")}
      canDeleteFiles={hasFormPermission(access.formRole, access.formProfile, "delete_files")}
      canDeleteJobs={access.formRole === "admin"}
      assignees={editableAssignees}
      orderEntry={orderEntry}
    />
  );
}
