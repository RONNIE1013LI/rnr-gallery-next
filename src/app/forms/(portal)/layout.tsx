import { FormsShell } from "@/components/forms/forms-shell";
import { headers } from "next/headers";
import { hasFormPermission } from "@/server/forms/forms-permissions";
import { requireFormsPage } from "@/server/forms/require-forms-page";

export default async function FormsPortalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers();
  const currentPath = requestHeaders.get("x-rnr-request-path") ?? "/order-system";
  const access = await requireFormsPage(
    currentPath,
    "access_forms",
  );
  return (
    <FormsShell
      operator={access.user}
      currentPath={currentPath}
      canCreateJobs={hasFormPermission(access.formRole, access.formProfile, "create_jobs")}
      canViewStats={hasFormPermission(access.formRole, access.formProfile, "view_stats")}
    >
      {children}
    </FormsShell>
  );
}
