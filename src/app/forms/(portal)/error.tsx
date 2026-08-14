"use client";

import styles from "@/components/forms/forms.module.css";

export default function FormsPortalError({
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <section className={styles.formsErrorState}>
      <p>Order Manager</p>
      <h1>The order workspace could not be loaded.</h1>
      <p>Your storefront and existing business records have not been changed. Retry the read request or return to the data list.</p>
      <div>
        <button type="button" onClick={reset}>Try again</button>
        <a href="/order-system">Data list</a>
      </div>
    </section>
  );
}
