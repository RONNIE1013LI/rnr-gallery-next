import Link from "next/link";
import { ProductionJobTable } from "@/components/admin/production-job-table";
import { ProductionSavedViews } from "@/components/admin/production-saved-views";
import styles from "@/components/admin/admin.module.css";
import { getAdminProductionRuntime } from "@/server/admin/admin-production-runtime";
import { getAdminProductionSavedViewRuntime } from "@/server/admin/admin-production-saved-view-runtime";
import { hasAdminPermission } from "@/server/auth/admin-permissions";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { parseProductionJobFilters } from "@/server/production/production-job-service";

type Props = Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>;
export const metadata = { title: "Production | R&R Gallery Admin" };

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
  return `/admin/jobs?${query}`;
}

const statuses = ["new", "designing", "awaiting_customer", "ready_to_print", "printing", "on_hold", "shipped", "completed", "cancelled"];
const payments = ["awaiting_payment", "processing", "paid", "failed", "cancelled", "refunded"];

export default async function AdminProductionJobsPage({ searchParams }: Props) {
  const raw = await searchParams;
  const query = queryString(raw);
  const access = await requireAdminPage(`/admin/jobs${query ? `?${query}` : ""}`, "view_production_jobs");
  const filters = parseProductionJobFilters(raw);
  const canViewFinance = hasAdminPermission(access.adminRole, "view_production_finance");
  const runtime = getAdminProductionRuntime();
  const actor = { userId: access.user.id, email: access.user.email ?? "unknown@invalid.local" };
  const [result, assignees, savedViews] = await Promise.all([
    runtime.list(filters, { canViewFinance }),
    runtime.assignees(),
    getAdminProductionSavedViewRuntime().list(actor),
  ]);
  const savable = new URLSearchParams();
  for (const key of ["source", "status", "payment", "urgent", "assigned", "from", "to", "sort", "direction"] as const) {
    const value = Array.isArray(raw[key]) ? raw[key]?.[0] : raw[key];
    if (value) savable.set(key, value);
  }

  return (
    <section className={styles.pageSection}>
      <header className={`${styles.pageHeader} ${styles.productionPageHeader}`}>
        <div><nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><span>Production</span></nav><h1>Production</h1><p>One operational queue for online orders and work entered manually by the studio.</p></div>
        <div className={styles.headerActions}><Link className={`${styles.recordCount} ${styles.productionHeaderLink}`} href="/admin/jobs/report">Operations report</Link>{hasAdminPermission(access.adminRole, "manage_production_fields") ? <Link className={`${styles.recordCount} ${styles.productionHeaderLink}`} href="/admin/jobs/fields">Form fields</Link> : null}{hasAdminPermission(access.adminRole, "export_production_jobs") ? <Link prefetch={false} className={`${styles.recordCount} ${styles.productionHeaderLink}`} href={`/api/admin/jobs/export${query ? `?${query}` : ""}`}>Export CSV</Link> : null}<span className={styles.recordCount}>{result.total} {result.total === 1 ? "job" : "jobs"}</span><Link className={styles.primaryAdminButton} href="/admin/jobs/new">New manual job</Link></div>
      </header>

      <ProductionSavedViews views={savedViews} currentQuery={savable.toString()} />

      <form className={styles.filterPanel} method="get">
        <label className={styles.searchField}><span>Job or customer</span><input name="q" type="search" defaultValue={filters.query} placeholder="Search production" /></label>
        <label><span>Source</span><select name="source" defaultValue={filters.source ?? ""}><option value="">All sources</option><option value="web">Online</option><option value="manual">Manual</option></select></label>
        <label><span>Status</span><select name="status" defaultValue={filters.status ?? ""}><option value="">All statuses</option>{statuses.map((value) => <option value={value} key={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
        <label><span>Payment</span><select name="payment" defaultValue={filters.paymentStatus ?? ""}><option value="">All payments</option>{payments.map((value) => <option value={value} key={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
        <label><span>Urgent</span><select name="urgent" defaultValue={filters.urgent === undefined ? "" : filters.urgent ? "yes" : "no"}><option value="">All jobs</option><option value="yes">Urgent only</option><option value="no">Not urgent</option></select></label>
        <label><span>Assigned</span><select name="assigned" defaultValue={filters.assignedUserId ?? ""}><option value="">Anyone</option>{assignees.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
        <label><span>Needed from</span><input type="date" name="from" defaultValue={filters.from ?? ""} /></label>
        <label><span>Needed to</span><input type="date" name="to" defaultValue={filters.to ?? ""} /></label>
        <label><span>Sort by</span><select name="sort" defaultValue={filters.sort}><option value="created">Created</option><option value="updated">Updated</option><option value="needed">Needed date</option></select></label>
        <label><span>Direction</span><select name="direction" defaultValue={filters.direction}><option value="desc">Latest first</option><option value="asc">Earliest first</option></select></label>
        <div className={styles.filterActions}><button type="submit">Apply filters</button><Link href="/admin/jobs">Clear</Link></div>
      </form>

      <ProductionJobTable jobs={result.items} canViewFinance={canViewFinance} />
      {result.pageCount > 1 ? <nav className={styles.pagination} aria-label="Production job pages">{result.page > 1 ? <Link href={pageHref(raw, result.page - 1)}>Previous</Link> : <span />}<span>Page {result.page} of {result.pageCount}</span>{result.page < result.pageCount ? <Link href={pageHref(raw, result.page + 1)}>Next</Link> : <span />}</nav> : null}
    </section>
  );
}
