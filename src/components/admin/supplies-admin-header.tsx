import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./admin.module.css";
import suppliesStyles from "./supplies-admin.module.css";

export function SuppliesAdminHeader({ title, description, active, actions }: Readonly<{ title: string; description: string; active: "overview" | "categories" | "products" | "settings"; actions?: ReactNode }>) {
  return <>
    <header className={styles.pageHeader}><div><nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span>{active === "overview" ? <span>Supplies</span> : <><Link href="/admin/supplies">Supplies</Link><span>/</span><span>{title}</span></>}</nav><h1>{title}</h1><p>{description}</p></div>{actions ? <div className={styles.headerActions}>{actions}</div> : null}</header>
    <nav className={suppliesStyles.tabs} aria-label="Supplies management">{([ ["overview", "/admin/supplies", "Overview"], ["categories", "/admin/supplies/categories", "Categories"], ["products", "/admin/supplies/products", "Products"], ["settings", "/admin/supplies/settings", "Settings"] ] as const).map(([key, href, label]) => <Link key={key} href={href} aria-current={active === key ? "page" : undefined}>{label}</Link>)}</nav>
  </>;
}

export function SuppliesSchemaPending() {
  return <div className={suppliesStyles.notice} role="status"><strong>Database upgrade pending</strong><p>Supplies storage is not ready. The public store remains OFF. Creating products, categories, images and changing visibility will become available after the separately approved database upgrade.</p><p className={suppliesStyles.hint}>No products, prices or stock have been populated. Existing orders and custom products are unaffected.</p></div>;
}
