import Link from "next/link";
import { AdminFilterDisclosure } from "@/components/admin/admin-filter-disclosure";
import styles from "@/components/admin/admin.module.css";
import { getAdminCustomerRuntime } from "@/server/admin/admin-customer-runtime";
import { requireAdminPage } from "@/server/auth/require-admin-page";

type Props = Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>;
const money = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" });
const date = new Intl.DateTimeFormat("en-NZ", { dateStyle: "medium", timeZone: "Pacific/Auckland" });

export const metadata = { title: "Customers | R&R Gallery Admin" };

export default async function AdminCustomersPage({ searchParams }: Props) {
  const params = await searchParams;
  const query = Array.isArray(params.q) ? params.q[0] : params.q;
  await requireAdminPage(`/admin/customers${query ? `?q=${encodeURIComponent(query)}` : ""}`, "view_customers");
  const result = await getAdminCustomerRuntime().list(params);
  return (
    <section className={styles.pageSection}>
      <header className={styles.pageHeader}><div><nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><span>Customers</span></nav><h1>Customers</h1><p>Registered accounts and guest customers derived from real order records.</p></div><span className={styles.recordCount}>{result.total} customers</span></header>
      <AdminFilterDisclosure>
        <form className={styles.filterPanel} method="get"><label className={styles.searchField}><span>Name or email</span><input type="search" name="q" defaultValue={query ?? ""} placeholder="Search customers" /></label><div className={styles.filterActions}><button type="submit">Search</button><Link href="/admin/customers">Clear</Link></div></form>
      </AdminFilterDisclosure>
      {result.items.length ? <div className={styles.tableScroll}><table className={styles.dataTable}><thead><tr><th>Customer</th><th>Phone / country</th><th>Account</th><th>Orders</th><th>Paid spend incl GST</th><th>Last order</th><th /></tr></thead><tbody>{result.items.map((customer) => <tr key={customer.key}><td><strong>{customer.name}</strong><small>{customer.email}</small><small>{customer.defaultAddress ?? "No order address"}</small></td><td><span>{customer.phone ?? "—"}</span><small>{customer.country ?? "—"}</small></td><td><span>{customer.registered ? customer.emailVerified ? "Verified" : "Registered" : "Guest"}</span></td><td className={styles.numeric}>{customer.orderCount}</td><td className={styles.numeric}>{money.format(customer.paidSpentInclGstCents / 100)}</td><td>{customer.lastOrderAt ? date.format(customer.lastOrderAt) : "—"}</td><td><Link className={styles.tableAction} aria-label={`Open ${customer.name}`} href={`/admin/customers/${encodeURIComponent(customer.key)}`}>Open</Link></td></tr>)}</tbody></table></div> : <div className={styles.emptyState}><h2>No customers match this search.</h2><p>Try a different name, email address or phone number.</p><Link href="/admin/customers">Clear search</Link></div>}
    </section>
  );
}
