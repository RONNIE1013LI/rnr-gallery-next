import styles from "@/components/forms/forms.module.css";

export default function FormsPortalLoading() {
  return (
    <div className={styles.formsLoadingState} role="status" aria-live="polite">
      <span>Loading order records…</span>
      <div />
      <div />
      <div />
    </div>
  );
}
