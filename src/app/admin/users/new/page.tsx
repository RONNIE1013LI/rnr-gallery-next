import Link from "next/link";
import { EmployeeCreateForm } from "@/components/admin/employee-create-form";
import styles from "@/components/admin/admin.module.css";
import { requireAdminPage } from "@/server/auth/require-admin-page";

export const metadata = { title: "Add employee | R&R Gallery Admin" };

export default async function NewAdminEmployeePage() {
  await requireAdminPage("/admin/users/new", "manage_roles");
  return <section className={`${styles.pageSection} ${styles.narrowPage}`}>
    <header className={styles.pageHeader}>
      <div><nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><Link href="/admin/users">Users</Link><span>/</span><span>Add employee</span></nav><h1>Add employee</h1><p>Create a Staff account with only the Admin and Forms permissions needed for their work.</p></div>
    </header>
    <div className={styles.safetyBanner} role="note"><strong>Initial password handling.</strong><p>The password is used only to create this account. It is never shown again, and the employee can later use Password Reset.</p></div>
    <EmployeeCreateForm />
  </section>;
}
