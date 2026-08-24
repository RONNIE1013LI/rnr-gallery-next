import Link from "next/link";
import { AdminFilterDisclosure } from "@/components/admin/admin-filter-disclosure";
import styles from "@/components/admin/admin.module.css";
import { getAdminUserRuntime } from "@/server/admin/admin-user-runtime";
import { parseAdminUserFilters, type AdminUserListItem } from "@/server/admin/admin-user-service";
import { requireAdminPage } from "@/server/auth/require-admin-page";

type Props = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export const metadata = { title: "Users | R&R Gallery Admin" };
const date = new Intl.DateTimeFormat("en-NZ", { dateStyle: "medium", timeZone: "Pacific/Auckland" });

function permissionSummary(account: AdminUserListItem) {
  if (account.role === "admin") return "Full Admin and Forms access";
  if (account.role === "form_staff") return `Forms preset: ${account.formPreset ?? "not set"}`;
  if (account.role === "staff") {
    const adminCount = account.adminPermissions?.length ?? 0;
    const formsCount = Object.values(account.formPermissions ?? {}).filter(Boolean).length;
    return `${adminCount} Admin · ${formsCount} Forms permissions${account.assignedOnly ? " · assigned jobs only" : ""}`;
  }
  return "No Admin or Forms access";
}

function queryString(params: Record<string, string | string[] | undefined>, includePage = true) {
  const query = new URLSearchParams();
  for (const key of ["q", "role", ...(includePage ? ["page"] : [])]) {
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value) query.set(key, value);
  }
  return query.toString();
}

function pageHref(params: Record<string, string | string[] | undefined>, page: number) {
  const query = new URLSearchParams(queryString(params, false));
  query.set("page", String(page));
  return `/admin/users?${query}`;
}

export default async function AdminUsersPage({ searchParams }: Props) {
  const params = await searchParams;
  const query = queryString(params);
  await requireAdminPage(`/admin/users${query ? `?${query}` : ""}`, "manage_roles");
  const filters = parseAdminUserFilters(params);
  const result = await getAdminUserRuntime().list(params);

  return (
    <section className={styles.pageSection}>
      <header className={styles.pageHeader}>
        <div>
          <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><span>Users</span></nav>
          <h1>Users</h1>
          <p>Search registered accounts and control access to the R&amp;R Gallery administration area.</p>
        </div>
        <div className={styles.headerActions}><span className={styles.recordCount}>{result.total} users</span><Link className={styles.primaryAdminButton} href="/admin/users/new">Add employee</Link></div>
      </header>

      <div className={styles.safetyBanner} role="note">
        <strong>Administrator-only access.</strong>
        <p>Role changes take effect on the next permission check and are recorded in the Audit Log. Your own role is locked here to prevent accidental loss of access.</p>
      </div>

      <AdminFilterDisclosure>
      <form className={styles.filterPanel} method="get">
        <label className={styles.searchField}><span>Email</span><input type="search" name="q" defaultValue={filters.query} placeholder="Search by email" /></label>
        <label><span>Role</span><select name="role" defaultValue={filters.role ?? ""}><option value="">All roles</option><option value="admin">Admin</option><option value="form_staff">Forms staff</option><option value="staff">Staff</option><option value="customer">Customer</option></select></label>
        <div className={styles.filterActions}><button type="submit">Search</button><Link href="/admin/users">Clear</Link></div>
      </form>
      </AdminFilterDisclosure>

      {result.items.length ? (
        <div className={styles.tableScroll} tabIndex={0} aria-label="Users table">
          <table className={`${styles.dataTable} ${styles.userTable}`}>
            <thead><tr><th>User</th><th>Verified</th><th>Joined</th><th>Last sign-in</th><th>Access</th><th><span className={styles.visuallyHidden}>Open</span></th></tr></thead>
            <tbody>{result.items.map((account) => (
              <tr key={account.id}>
                <td><strong>{account.name}</strong><small>{account.email}</small></td>
                <td><span className={styles.statusBadge}>{account.emailVerified ? "Verified" : "Not verified"}</span></td>
                <td className={styles.numeric}>{date.format(account.createdAt)}</td>
                <td className={styles.numeric}>{account.lastSeenAt ? <><span>{date.format(account.lastSeenAt)}</span><small>{account.activeSessions} active {account.activeSessions === 1 ? "session" : "sessions"}</small></> : <span>Never</span>}</td>
                <td><strong>{account.role === "form_staff" ? "Forms staff" : account.role[0].toUpperCase() + account.role.slice(1)}</strong><small>{permissionSummary(account)}</small></td>
                <td><Link className={styles.tableAction} href={`/admin/users/${encodeURIComponent(account.id)}`} aria-label={`Open ${account.name}`}>Open</Link></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div className={styles.emptyState}><h2>No users match these filters.</h2><p>Try a different email address or role.</p><Link href="/admin/users">Clear filters</Link></div>
      )}

      {result.pageCount > 1 ? (
        <nav className={styles.pagination} aria-label="User pages">
          {result.page > 1 ? <Link href={pageHref(params, result.page - 1)}>Previous</Link> : <span />}
          <span>Page {result.page} of {result.pageCount}</span>
          {result.page < result.pageCount ? <Link href={pageHref(params, result.page + 1)}>Next</Link> : <span />}
        </nav>
      ) : null}
    </section>
  );
}
