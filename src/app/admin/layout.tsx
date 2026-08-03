import Link from "next/link";
import { requireAdmin } from "@/server/auth/require-admin";
import styles from "@/components/storefront.module.css";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireAdmin();
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
