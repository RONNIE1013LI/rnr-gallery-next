import Link from "next/link";
import styles from "@/components/admin/admin.module.css";
import { requireAdminPage } from "@/server/auth/require-admin-page";

export const metadata = { title: "Add employee | R&R Gallery Admin" };

export default async function NewAdminEmployeePage() {
  await requireAdminPage("/admin/users/new", "manage_roles");
  return <section className={`${styles.pageSection} ${styles.narrowPage}`}>
    <header className={styles.pageHeader}>
      <div><nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><Link href="/admin/users">Users</Link><span>/</span><span>Add employee</span></nav><h1>Add employee</h1><p>Invite each employee to set their own password and secure their account.</p></div>
    </header>
    <p>Manage staff invitations, roles and authentication from Account Security. Verify your identity there before changing access.</p>
    <Link href="/account/security?next=%2Fadmin%2Fusers">Open staff account security</Link>
  </section>;
}
