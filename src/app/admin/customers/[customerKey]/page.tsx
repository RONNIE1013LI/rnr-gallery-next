import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "@/components/admin/admin.module.css";
import { getAdminCustomerRuntime } from "@/server/admin/admin-customer-runtime";
import { requireAdminPage } from "@/server/auth/require-admin-page";

type Props = Readonly<{ params: Promise<{ customerKey: string }> }>;
const money = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" });
const date = new Intl.DateTimeFormat("en-NZ", { dateStyle: "medium", timeStyle: "short", timeZone: "Pacific/Auckland" });
const label = (value: string) => value.replaceAll("_", " ");

export default async function AdminCustomerDetailPage({ params }: Props) {
  const { customerKey } = await params;
  await requireAdminPage(`/admin/customers/${encodeURIComponent(customerKey)}`, "view_customers");
  const detail = await getAdminCustomerRuntime().detail(customerKey);
  if (!detail) notFound();
  return <section className={styles.pageSection}>
    <header className={styles.pageHeader}><div><nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><Link href="/admin/customers">Customers</Link><span>/</span><span>{detail.name}</span></nav><h1>{detail.name}</h1><p>{detail.email}</p></div><span className={styles.recordCount}>{detail.account ? detail.account.emailVerified ? "Verified account" : "Registered account" : "Guest customer"}</span></header>
    <div className={styles.twoColumnPanels}>
      <section className={styles.panel}><h2>Order history</h2>{detail.orders.length ? <div className={styles.compactRows}>{detail.orders.map((order) => <Link href={`/admin/orders/${order.id}`} key={order.id}><span><strong>{order.orderNumber}</strong><small>{date.format(order.createdAt)}</small></span><span><strong>{money.format(order.totalInclGstCents / 100)}</strong><small>{label(order.fulfilmentStatus)} · {label(order.paymentStatus)}</small></span></Link>)}</div> : <p className={styles.mutedText}>No orders.</p>}</section>
      <section className={styles.panel}><h2>Recent saved order addresses</h2>{detail.addresses.length ? <div className={styles.addressStack}>{detail.addresses.map((address, index) => <address key={`${address.kind}-${index}`}><strong>{address.fullName}</strong><span>{address.building} {address.street}</span><span>{address.suburb}, {address.region} {address.postcode}</span><span>{address.country} · {address.phone}</span><small>{address.kind}</small></address>)}</div> : <p className={styles.mutedText}>No addresses stored in order records.</p>}</section>
    </div>
  </section>;
}
