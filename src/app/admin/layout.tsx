import type { Metadata } from "next";
import { headers } from "next/headers";
import { AdminShell } from "@/components/admin/admin-shell";
import { requireAdminPage } from "@/server/auth/require-admin-page";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers();
  const access = await requireAdminPage(requestHeaders.get("x-rnr-request-path") ?? "/admin");
  return (
    <AdminShell administrator={{
      name: access.user.name ?? access.user.email ?? "Administrator",
      email: access.user.email ?? "Administrator",
      role: access.adminRole,
      permissions: access.adminPermissions,
    }}>
      {children}
    </AdminShell>
  );
}
