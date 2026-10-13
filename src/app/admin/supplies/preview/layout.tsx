import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import styles from "./preview.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Supplies Preview", robots: { index: false, follow: false, noarchive: true } };

export default async function PreviewLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireAdminPage("/admin/supplies/preview", "manage_content");
  return <div className={styles.preview}><aside className={styles.notice}>
    <strong>Preview Mode — Not Public</strong><span>Payment is disabled. Preview does not change your shopping cart.</span>
    <nav aria-label="Supplies preview controls"><Link href="/admin/supplies/preview">Preview Published Products</Link><Link href="/admin/supplies/preview?drafts=1">Preview Draft Products</Link><Link href="/admin/supplies">Back to Supplies Admin</Link></nav>
  </aside>{children}</div>;
}
