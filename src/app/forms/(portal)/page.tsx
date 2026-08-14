import { FormsWorkbench } from "@/components/forms/forms-workbench";
import { getDatabase } from "@/server/db/client";
import { listFormOrders } from "@/server/forms/drizzle-forms-workbench-repository";
import { hasFormPermission } from "@/server/forms/forms-permissions";
import { parseFormWorkbenchQuery } from "@/server/forms/forms-workbench-service";
import { requireFormsPage } from "@/server/forms/require-forms-page";
import { getFormsSavedViewRuntime } from "@/server/forms/forms-saved-view-runtime";
import { listProductionAssignees } from "@/server/production/drizzle-production-job-repository";

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
  const canManageViews = hasFormPermission(access.formRole, access.formProfile, "manage_views");
  const canUpdate = hasFormPermission(access.formRole, access.formProfile, "update_jobs");
  const [result, savedViews, assignees] = await Promise.all([
    listFormOrders(getDatabase(), query, {
      actorUserId: access.user.id,
      assignedOnly: access.formRole === "form_staff"
        ? access.formProfile?.assignedOnly ?? false
        : false,
      canViewCustomerContact: hasFormPermission(
        access.formRole,
        access.formProfile,
        "view_customer_contact",
      ),
      canViewFinance,
    }),
    canManageViews
      ? getFormsSavedViewRuntime().list({
          userId: access.user.id,
          email: access.user.email ?? "unknown@invalid.local",
        })
      : Promise.resolve([]),
    canUpdate ? listProductionAssignees(getDatabase()) : Promise.resolve([]),
  ]);
  return (
    <FormsWorkbench
      result={result}
      query={query}
      canExport={hasFormPermission(access.formRole, access.formProfile, "export_jobs")}
      canViewFinance={canViewFinance}
      canManageViews={canManageViews}
      savedViews={savedViews}
      canUpdate={canUpdate}
      canUpdateFinance={hasFormPermission(access.formRole, access.formProfile, "update_finance")}
      canUpdateProductionStatus={hasFormPermission(access.formRole, access.formProfile, "update_production_status")}
      canUpdateDeliveryStatus={hasFormPermission(access.formRole, access.formProfile, "update_delivery_status")}
      canUploadFiles={hasFormPermission(access.formRole, access.formProfile, "upload_files")}
      canReviewProofs={hasFormPermission(access.formRole, access.formProfile, "update_production_status")}
      assignees={assignees}
    />
  );
}
