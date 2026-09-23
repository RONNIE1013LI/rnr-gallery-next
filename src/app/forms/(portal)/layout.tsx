import { FormsShell } from "@/components/forms/forms-shell";
import { headers } from "next/headers";
import { hasFormPermission } from "@/server/forms/forms-permissions";
import { requireFormsPage } from "@/server/forms/require-forms-page";
import { hasAdminPermission } from "@/server/auth/admin-permissions";
import { isStaffAccessProfile } from "@/server/auth/staff-access-profile";

export default async function FormsPortalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers();
  const currentPath = requestHeaders.get("x-rnr-request-path") ?? "/order-system";
  const access = await requireFormsPage(
    currentPath,
    "access_forms",
  );
  const adminPermissions = isStaffAccessProfile(access.formProfile)
    ? access.formProfile.adminPermissions
    : [];
  return (
    <FormsShell
      operator={access.user}
      currentPath={currentPath}
      canCreateJobs={hasFormPermission(access.formRole, access.formProfile, "create_jobs")}
      canViewStats={hasFormPermission(access.formRole, access.formProfile, "view_stats")}
      canManagePayment={hasAdminPermission(access.formRole, adminPermissions, "manage_payment")}
    >
      {children}
    </FormsShell>
  );
}
