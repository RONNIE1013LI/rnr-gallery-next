"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { hasAdminPermission, type AdminRole } from "@/server/auth/admin-permissions";
import styles from "./admin.module.css";

type AdminShellProps = Readonly<{
  administrator: Readonly<{ name: string; email: string; role: AdminRole }>;
  children: React.ReactNode;
}>;

const navigation = [
  { label: "Dashboard", href: "/admin", permission: "access_admin" },
  { label: "Orders", href: "/admin/orders", permission: "view_orders" },
  { label: "Production", href: "/admin/jobs", permission: "view_production_jobs" },
  { label: "Customers", href: "/admin/customers", permission: "view_customers" },
  { label: "Users", href: "/admin/users", permission: "manage_roles" },
  { label: "Products", href: "/admin/products", permission: "manage_prices" },
  { label: "Design Gallery", href: "/admin/design-gallery", permission: "manage_gallery" },
  { label: "Content", href: "/admin/content", permission: "manage_content" },
  { label: "Media", href: "/admin/media", permission: "delete_media" },
  { label: "Shipping", href: "/admin/settings/shipping", permission: "manage_shipping" },
  { label: "Payment", href: "/admin/settings/payment", permission: "manage_payment" },
  { label: "Audit Log", href: "/admin/audit", permission: "view_audit" },
] as const;

function Navigation({ ariaLabel = "Administration", role, onNavigate }: Readonly<{
  ariaLabel?: string;
  role: AdminRole;
  onNavigate?: () => void;
}>) {
  return (
    <nav className={styles.navigation} aria-label={ariaLabel}>
      {navigation
        .filter((item) => hasAdminPermission(role, item.permission))
        .map((item) => (
          <Link href={item.href} key={item.href} onClick={onNavigate}>{item.label}</Link>
        ))}
    </nav>
  );
}

export function AdminShell({ administrator, children }: AdminShellProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const closeMobileMenu = useCallback(() => setIsMobileMenuOpen(false), []);

  useEffect(() => {
    if (!isMobileMenuOpen) return;

    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = document.documentElement.clientWidth > 0
      ? window.innerWidth - document.documentElement.clientWidth
      : 0;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMobileMenu();
    };

    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, [closeMobileMenu, isMobileMenuOpen]);

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span>R&amp;R Gallery</span>
          <strong>Operations</strong>
        </div>
        <Navigation role={administrator.role} />
        <Link className={styles.publicLink} href="/">View storefront</Link>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <div className={styles.mobileMenu}>
            <button
              type="button"
              aria-label={isMobileMenuOpen ? "Close administration menu" : "Open administration menu"}
              aria-expanded={isMobileMenuOpen}
              aria-controls="admin-mobile-navigation"
              onClick={() => setIsMobileMenuOpen((open) => !open)}
            >
              {isMobileMenuOpen ? "Close" : "Menu"}
            </button>
            {isMobileMenuOpen ? (
              <div id="admin-mobile-navigation" className={styles.mobileMenuPanel}>
                <Navigation
                  ariaLabel="Administration menu"
                  role={administrator.role}
                  onNavigate={closeMobileMenu}
                />
              </div>
            ) : null}
          </div>
          <div className={styles.identity}>
            <span>{administrator.email}</span>
            <span className={styles.role}>{administrator.role === "admin" ? "Admin" : "Staff"}</span>
          </div>
        </header>
        <main id="main-content" className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
