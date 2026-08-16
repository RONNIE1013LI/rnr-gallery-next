import Link from "next/link";

import { FormsSignOut } from "./forms-sign-out";
import { FormsOrderEntryLink } from "./forms-order-entry-link";
import styles from "./forms.module.css";

export function FormsShell({
  operator,
  canCreateJobs,
  canViewStats,
  currentPath = "/order-system",
  children,
}: Readonly<{
  operator: Readonly<{ name?: string; email?: string }>;
  canCreateJobs: boolean;
  canViewStats: boolean;
  currentPath?: string;
  children: React.ReactNode;
}>) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brandRow}>
          <nav className={styles.primaryNav} aria-label="Forms workspace">
            <Link href="/order-system" aria-current={currentPath === "/order-system" ? "page" : undefined}>Data list</Link>
            {canViewStats ? <Link href="/order-system/stats" aria-current={currentPath.startsWith("/order-system/stats") ? "page" : undefined}>Custom stats</Link> : null}
          </nav>
        </div>
        <Link className={styles.galleryLink} href="/">Gallery</Link>
        <div className={styles.operatorActions}>
          <span className={styles.operatorIdentity} title={operator.email}>
            {operator.name || operator.email || "Operator"}
          </span>
          <FormsSignOut />
          {canCreateJobs ? <FormsOrderEntryLink currentPath={currentPath} /> : null}
        </div>
      </header>
      <main id="main-content" className={styles.workspace}>{children}</main>
    </div>
  );
}
