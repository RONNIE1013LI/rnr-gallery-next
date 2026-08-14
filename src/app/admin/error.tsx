"use client";

import styles from "@/components/admin/admin.module.css";

export default function AdminError({ reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return <section className={styles.errorState}><p>Administration</p><h1>This Admin page could not be loaded.</h1><p>Your storefront and existing business records have not been changed. Retry the read request or return to the dashboard.</p><div><button type="button" onClick={reset}>Try again</button><a href="/admin">Dashboard</a></div></section>;
}
