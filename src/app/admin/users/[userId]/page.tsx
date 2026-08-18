import Link from "next/link";
import { notFound } from "next/navigation";
import { EmployeeAccessForm } from "@/components/admin/employee-access-form";
import styles from "@/components/admin/admin.module.css";
import { getAdminUserRuntime } from "@/server/admin/admin-user-runtime";
import { requireAdminPage } from "@/server/auth/require-admin-page";

type Props = Readonly<{ params: Promise<{ userId: string }> }>;
export const metadata = { title: "Employee access | R&R Gallery Admin" };

export default async function AdminEmployeeDetailPage({ params }: Props) {
  const { userId } = await params;
  const access = await requireAdminPage(`/admin/users/${encodeURIComponent(userId)}`, "manage_roles");
  const account = await getAdminUserRuntime().getById(userId);
  if (!account) notFound();
  return <section className={`${styles.pageSection} ${styles.narrowPage}`}>
    <header className={styles.pageHeader}>
      <div><nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><Link href="/admin/users">Users</Link><span>/</span><span>{account.name}</span></nav><h1>{account.name}</h1><p>Review account type and the exact permissions available to this user.</p></div>
    </header>
    <EmployeeAccessForm account={account} currentUserId={access.user.id} />
  </section>;
}
