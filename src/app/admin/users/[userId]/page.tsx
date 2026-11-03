import Link from "next/link";
import { notFound } from "next/navigation";
import { EmployeeAccessForm } from "@/components/admin/employee-access-form";
import styles from "@/components/admin/admin.module.css";
import { getAdminUserRuntime } from "@/server/admin/admin-user-runtime";
import { UserShoppingHistoryPanel } from "@/components/admin/user-shopping-history";
import { getUserShoppingHistory } from "@/server/analytics/user-shopping-history";
import { hasAdminPermission } from "@/server/auth/admin-permissions";
import { requireAdminPage } from "@/server/auth/require-admin-page";

type Props = Readonly<{ params: Promise<{ userId: string }> }>;
export const metadata = { title: "Employee access | R&R Gallery Admin" };

export default async function AdminEmployeeDetailPage({ params }: Props) {
  const { userId } = await params;
  const access = await requireAdminPage(`/admin/users/${encodeURIComponent(userId)}`, "manage_roles", { readOnly: true });
  const account = await getAdminUserRuntime().getById(userId);
  if (!account) notFound();
  const canViewHistory = (["view_customers", "view_analytics", "view_orders"] as const)
    .every(permission => hasAdminPermission(access.adminRole, access.adminPermissions ?? [], permission));
  const history = canViewHistory ? await getUserShoppingHistory(account.id) : null;
  return <section className={`${styles.pageSection} ${styles.narrowPage}`}>
    <header className={styles.pageHeader}>
      <div><nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><Link href="/admin/users">Users</Link><span>/</span><span>{account.name}</span></nav><h1>{account.name}</h1><p>Review account type and the exact permissions available to this user.</p></div>
    </header>
    <EmployeeAccessForm account={account} currentUserId={access.user.id} />
    {history ? <UserShoppingHistoryPanel history={history} /> : null}
  </section>;
}
