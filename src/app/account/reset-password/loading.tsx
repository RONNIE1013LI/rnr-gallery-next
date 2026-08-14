import styles from "@/components/storefront.module.css";

export default function ResetPasswordLoading() {
  return <main id="main-content" className={styles.legalPage}>
    <article className={styles.authPage} aria-busy="true" aria-live="polite">
      <p className={styles.eyebrow}>Customer account</p>
      <h1>Checking your reset link…</h1>
      <p className={styles.authLead}>This will only take a moment.</p>
    </article>
  </main>;
}
