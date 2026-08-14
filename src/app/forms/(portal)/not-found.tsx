import Link from "next/link";

import styles from "@/components/forms/forms.module.css";

export default function FormsPortalNotFound() {
  return (
    <section className={styles.formsErrorState}>
      <p>Order Manager</p>
      <h1>Order record not found.</h1>
      <p>The requested record does not exist, has been removed, or is outside your assigned work.</p>
      <div>
        <Link href="/order-system">Data list</Link>
        <Link href="/order-system/new">Order entry</Link>
      </div>
    </section>
  );
}
