import Link from "next/link";

import { FormsSignOut } from "./forms-sign-out";
import { FormsOrderEntryLink } from "./forms-order-entry-link";
import styles from "./forms.module.css";

export function FormsShell({
  operator,
  canCreateJobs,
  canViewStats,
  canManagePayment,
  currentPath = "/order-system",
  children,
}: Readonly<{
  operator: Readonly<{ name?: string; email?: string }>;
  canCreateJobs: boolean;
  canViewStats: boolean;
  canManagePayment: boolean;
  currentPath?: string;
  children: React.ReactNode;
}>) {
  const currentRoute = currentPath.split("?", 1)[0];
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brandRow}>
          <nav className={styles.primaryNav} aria-label="Forms workspace">
            <Link href="/order-system" aria-current={currentRoute === "/order-system" ? "page" : undefined}>Data list</Link>
            {canViewStats ? <Link href="/order-system/stats" aria-current={currentRoute === "/order-system/stats" ? "page" : undefined}>Custom stats</Link> : null}
            {canManagePayment ? <Link className={styles.paymentRequestNav} href="/admin/payment-requests">AfterPay Req.</Link> : null}
          </nav>
        </div>
        <div className={styles.operatorActions}>
          <span className={styles.operatorIdentity} title={operator.email}>
            {operator.name || operator.email || "Operator"}
          </span>
          <FormsSignOut />
          {canManagePayment ? <Link className={styles.paymentRequestAction} href="/admin/payment-requests">AfterPay Req.</Link> : null}
          {canCreateJobs ? <FormsOrderEntryLink currentPath={currentPath} /> : null}
        </div>
      </header>
      <main
        id="main-content"
        className={`${styles.workspace}${currentRoute === "/order-system" ? ` ${styles.dataListWorkspace}` : ""}`}
      >{children}</main>
    </div>
  );
}
