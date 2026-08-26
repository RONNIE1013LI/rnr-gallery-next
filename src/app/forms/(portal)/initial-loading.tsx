import styles from "@/components/forms/forms.module.css";

export function FormsInitialLoading() {
  return (
    <div className={styles.formsInitialLoading} role="status" aria-live="polite">
      Loading orders…
    </div>
  );
}
