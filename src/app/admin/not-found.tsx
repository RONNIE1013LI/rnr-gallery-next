import Link from "next/link";
import styles from "@/components/admin/admin.module.css";

export default function AdminNotFound() {
  return <section className={styles.errorState}><p>Administration</p><h1>Record not found.</h1><p>The requested Admin record does not exist or is no longer available.</p><div><Link href="/admin">Dashboard</Link><Link href="/admin/orders">Orders</Link></div></section>;
}
