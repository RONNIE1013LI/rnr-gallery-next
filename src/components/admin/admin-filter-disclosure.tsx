import styles from "./admin.module.css";

export function AdminFilterDisclosure({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <details className={styles.filterDisclosure}>
      <summary>
        <span>Search and filters</span>
        <span aria-hidden="true">Show controls</span>
      </summary>
      {children}
    </details>
  );
}
