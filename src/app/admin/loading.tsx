import styles from "@/components/admin/admin.module.css";

export default function AdminLoading() {
  return <div className={styles.loadingState} role="status" aria-live="polite"><span>Loading administration data…</span><div /><div /><div /></div>;
}
