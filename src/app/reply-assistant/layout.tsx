import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/admin-shell";
import { requireAdminPage } from "@/server/auth/require-admin-page";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function ReplyAssistantLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const access = await requireAdminPage(
    "/reply-assistant",
    "use_reply_assistant",
  );
  return (
    <AdminShell
      administrator={{
        name: access.user.name ?? access.user.email ?? "Administrator",
        email: access.user.email ?? "Administrator",
        role: access.adminRole,
      }}
    >
      {children}
    </AdminShell>
  );
}
