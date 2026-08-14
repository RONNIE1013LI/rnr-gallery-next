import Link from "next/link";
import { AdminOrderTable } from "@/components/admin/order-table";
import styles from "@/components/admin/admin.module.css";
import { getAdminOrderRuntime } from "@/server/admin/admin-order-runtime";
import { parseAdminOrderFilters } from "@/server/admin/order-admin-service";
import { requireAdminPage } from "@/server/auth/require-admin-page";

type Props = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export const metadata = { title: "Orders | R&R Gallery Admin" };

function queryString(values: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams();
  for (const [key, raw] of Object.entries(values)) {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value) query.set(key, value);
  }
  return query.toString();
}

function pageHref(params: Record<string, string | string[] | undefined>, page: number) {
  const query = new URLSearchParams(queryString(params));
  query.set("page", String(page));
  return `/admin/orders?${query}`;
}

export default async function AdminOrdersPage({ searchParams }: Props) {
  const raw = await searchParams;
  const query = queryString(raw);
  await requireAdminPage(`/admin/orders${query ? `?${query}` : ""}`, "view_orders");
  const filters = parseAdminOrderFilters(raw);
  const result = await getAdminOrderRuntime().list(filters);

  return (
    <section className={styles.pageSection}>
      <header className={styles.pageHeader}>
        <div>
          <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><span>Orders</span></nav>
          <h1>Orders</h1>
          <p>Search, review and progress real customer orders. Price snapshots remain read only.</p>
        </div>
        <span className={styles.recordCount}>{result.total} orders</span>
      </header>

      <form className={styles.filterPanel} method="get">
        <label className={styles.searchField}>
          <span>Order, customer or email</span>
          <input name="q" type="search" defaultValue={filters.query} placeholder="Search orders" />
        </label>
        <label><span>Order status</span><select name="status" defaultValue={filters.fulfilmentStatus ?? ""}><option value="">All statuses</option>{["new", "designing", "awaiting_customer", "ready_to_print", "printing", "on_hold", "shipped", "completed", "cancelled"].map((value) => <option value={value} key={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
        <label><span>Payment</span><select name="payment" defaultValue={filters.paymentStatus ?? ""}><option value="">All payments</option>{["awaiting_payment", "processing", "paid", "failed", "cancelled", "refunded"].map((value) => <option value={value} key={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
        <label><span>Country</span><select name="country" defaultValue={filters.country ?? ""}><option value="">All countries</option><option value="NZ">New Zealand</option><option value="AU">Australia</option></select></label>
        <label><span>Delivery</span><select name="delivery" defaultValue={filters.deliveryMethod ?? ""}><option value="">All methods</option><option value="post">Post</option><option value="pickup">Pickup</option></select></label>
        <label><span>Urgent</span><select name="urgent" defaultValue={filters.urgent === undefined ? "" : filters.urgent ? "yes" : "no"}><option value="">All orders</option><option value="yes">Urgent only</option><option value="no">Not urgent</option></select></label>
        <label><span>From</span><input type="date" name="from" defaultValue={filters.from ?? ""} /></label>
        <label><span>To</span><input type="date" name="to" defaultValue={filters.to ?? ""} /></label>
        <label><span>Sort by</span><select name="sort" defaultValue={filters.sort}><option value="created">Created</option><option value="updated">Last updated</option><option value="total">Order total</option></select></label>
        <label><span>Direction</span><select name="direction" defaultValue={filters.direction}><option value="desc">Newest / highest first</option><option value="asc">Oldest / lowest first</option></select></label>
        <div className={styles.filterActions}><button type="submit">Apply filters</button><Link href="/admin/orders">Clear</Link></div>
      </form>

      {filters.validationMessage ? (
        <p className={styles.filterError} role="alert">{filters.validationMessage}</p>
      ) : null}

      <AdminOrderTable orders={result.items} />
      {result.pageCount > 1 ? (
        <nav className={styles.pagination} aria-label="Order pages">
          {result.page > 1 ? <Link href={pageHref(raw, result.page - 1)}>Previous</Link> : <span />}
          <span>Page {result.page} of {result.pageCount}</span>
          {result.page < result.pageCount ? <Link href={pageHref(raw, result.page + 1)}>Next</Link> : <span />}
        </nav>
      ) : null}
    </section>
  );
}
