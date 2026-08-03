import Link from "next/link";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import styles from "@/components/storefront.module.css";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireAdminPage();
  return (
    <main id="main-content" className={styles.adminPage}>
      <nav className={styles.adminNavigation} aria-label="Administration">
        <Link href="/admin/design-gallery">Design Gallery</Link>
        <Link href="/design-gallery">View public gallery</Link>
      </nav>
      {children}
    </main>
  );
}
