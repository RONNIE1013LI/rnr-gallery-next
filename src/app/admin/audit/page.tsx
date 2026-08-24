import Link from "next/link";
import { AdminFilterDisclosure } from "@/components/admin/admin-filter-disclosure";
import styles from "@/components/admin/admin.module.css";
import { getAdminAuditRuntime } from "@/server/admin/admin-audit-runtime";
import { requireAdminPage } from "@/server/auth/require-admin-page";

type Props = Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>;
const date = new Intl.DateTimeFormat("en-NZ", { dateStyle: "medium", timeStyle: "medium", timeZone: "Pacific/Auckland" });
const scalar = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

function summary(value: Record<string, unknown> | null | undefined) {
  if (!value) return "—";
  return Object.entries(value).map(([key, child]) => `${key}: ${Array.isArray(child) ? child.join(", ") : String(child ?? "—")}`).join(" · ");
}

export default async function AdminAuditPage({ searchParams }: Props) {
  const params = await searchParams;
  await requireAdminPage("/admin/audit", "view_audit");
  const result = await getAdminAuditRuntime().list(params);
  return <section className={styles.pageSection}>
    <header className={styles.pageHeader}><div><nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><span>Audit Log</span></nav><h1>Audit log</h1><p>Immutable summaries of privileged Admin actions. Secrets, tokens and raw request payloads are never stored here.</p></div><span className={styles.recordCount}>{result.total} events</span></header>
    <AdminFilterDisclosure>
      <form className={styles.filterPanel} method="get"><label className={styles.searchField}><span>Actor or resource</span><input type="search" name="q" defaultValue={scalar(params.q) ?? ""} /></label><label><span>Action</span><input name="action" defaultValue={scalar(params.action) ?? ""} placeholder="content.published" /></label><label><span>Result</span><select name="result" defaultValue={scalar(params.result) ?? ""}><option value="">All</option><option value="success">Success</option><option value="failure">Failure</option></select></label><label><span>From</span><input type="date" name="from" defaultValue={scalar(params.from) ?? ""} /></label><label><span>To</span><input type="date" name="to" defaultValue={scalar(params.to) ?? ""} /></label><div className={styles.filterActions}><button type="submit">Apply</button><Link href="/admin/audit">Clear</Link></div></form>
    </AdminFilterDisclosure>
    {result.items.length ? <div className={styles.tableScroll}><table className={`${styles.dataTable} ${styles.auditTable}`}><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Resource</th><th>Change summary</th><th>Result</th></tr></thead><tbody>{result.items.map((entry) => <tr key={entry.id}><td className={styles.numeric}>{date.format(entry.createdAt)}</td><td><strong>{entry.actorEmail}</strong><small>{entry.requestSource ?? "—"}</small></td><td><strong>{entry.action}</strong></td><td><span>{entry.resourceType}</span><small>{entry.resourceId ?? "—"}</small></td><td><small>Before: {summary(entry.beforeSummary)}</small><small>After: {summary(entry.afterSummary)}</small></td><td><span className={styles.statusBadge}>{entry.result}</span></td></tr>)}</tbody></table></div> : <div className={styles.emptyState}><h2>No audit events match these filters.</h2><p>Privileged changes will appear here.</p></div>}
  </section>;
}
