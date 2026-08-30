"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { hasAdminPermission, type AdminPermission, type AdminRole } from "@/server/auth/admin-permissions";
import styles from "./admin.module.css";

type AdminShellProps = Readonly<{
  administrator: Readonly<{
    name: string;
    email: string;
    role: AdminRole;
    permissions: readonly AdminPermission[];
  }>;
  children: React.ReactNode;
}>;

const dashboardNavigation = { label: "Dashboard", href: "/admin", permission: "access_admin" } as const;
const navigationGroups = [
  {
    label: "Orders",
    items: [
      { label: "Orders", href: "/admin/orders", permission: "view_orders" },
      { label: "Customers", href: "/admin/customers", permission: "view_customers" },
    ],
  },
  {
    label: "Production",
    items: [
      { label: "Production", href: "/admin/jobs", permission: "view_production_jobs" },
      { label: "Shipping", href: "/admin/settings/shipping", permission: "manage_shipping" },
    ],
  },
  {
    label: "Content",
    items: [
      { label: "Products", href: "/admin/products", permission: "manage_prices" },
      { label: "Design Gallery", href: "/admin/design-gallery", permission: "manage_gallery" },
      { label: "Content", href: "/admin/content", permission: "manage_content" },
      { label: "Customer Reviews", href: "/admin/customer-reviews", permission: "manage_reviews" },
      { label: "Media", href: "/admin/media", permission: "delete_media" },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Payment", href: "/admin/settings/payment", permission: "manage_payment" },
      { label: "Payment Requests", href: "/admin/payment-requests", permission: "manage_payment" },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Users", href: "/admin/users", permission: "manage_roles" },
      { label: "Email templates", href: "/admin/settings/email-templates", permission: "manage_content" },
      { label: "Notification emails", href: "/admin/settings/notifications", permission: "manage_roles" },
      { label: "Advertising tracking", href: "/admin/settings/advertising", permission: "publish_content" },
      { label: "Website Analytics", href: "/admin/analytics", permission: "view_analytics" },
      { label: "Audit Log", href: "/admin/audit", permission: "view_audit" },
      { label: "Reply Assistant", href: "/reply-assistant", permission: "use_reply_assistant" },
    ],
  },
] as const;

function Navigation({ ariaLabel = "Administration", role, permissions, onNavigate }: Readonly<{
  ariaLabel?: string;
  role: AdminRole;
  permissions: readonly AdminPermission[];
  onNavigate?: () => void;
}>) {
  const canOpen = (permission: AdminPermission) => hasAdminPermission(role, permissions, permission);
  return (
    <nav className={styles.navigation} aria-label={ariaLabel}>
      {canOpen(dashboardNavigation.permission) ? (
        <Link className={styles.navigationHome} href={dashboardNavigation.href} onClick={onNavigate}>
          {dashboardNavigation.label}
        </Link>
      ) : null}
      {navigationGroups.map((group) => {
        const items = group.items.filter((item) => canOpen(item.permission));
        return items.length ? (
          <div className={styles.navigationGroup} key={group.label}>
            <span>{group.label}</span>
            {items.map((item) => (
              <Link href={item.href} key={item.href} onClick={onNavigate}>{item.label}</Link>
            ))}
          </div>
        ) : null;
      })}
    </nav>
  );
}

export function AdminShell({ administrator, children }: AdminShellProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenuPanelRef = useRef<HTMLDivElement>(null);
  const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreMobileMenuFocusRef = useRef(false);
  const closeMobileMenu = useCallback(() => {
    restoreMobileMenuFocusRef.current = true;
    setIsMobileMenuOpen(false);
  }, []);
  const closeMobileMenuAfterNavigation = useCallback(() => {
    restoreMobileMenuFocusRef.current = false;
    setIsMobileMenuOpen(false);
  }, []);

  useEffect(() => {
    if (!isMobileMenuOpen) return;

    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = document.documentElement.clientWidth > 0
      ? window.innerWidth - document.documentElement.clientWidth
      : 0;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMobileMenu();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        mobileMenuRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled):not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && (document.activeElement === first || !mobileMenuRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
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

  useEffect(() => {
    if (isMobileMenuOpen) {
      mobileMenuPanelRef.current?.querySelector<HTMLElement>("a[href]")?.focus();
    } else if (restoreMobileMenuFocusRef.current) {
      mobileMenuTriggerRef.current?.focus();
      restoreMobileMenuFocusRef.current = false;
    }
  }, [isMobileMenuOpen]);

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span>R&amp;R Gallery</span>
          <strong>Operations</strong>
        </div>
        <Navigation role={administrator.role} permissions={administrator.permissions} />
        <Link className={styles.publicLink} href="/">View storefront</Link>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <div ref={mobileMenuRef} className={styles.mobileMenu}>
            <button
              ref={mobileMenuTriggerRef}
              type="button"
              aria-label={isMobileMenuOpen ? "Close administration menu" : "Open administration menu"}
              aria-expanded={isMobileMenuOpen}
              aria-controls="admin-mobile-navigation"
              onClick={() => {
                if (isMobileMenuOpen) {
                  closeMobileMenu();
                } else {
                  restoreMobileMenuFocusRef.current = false;
                  setIsMobileMenuOpen(true);
                }
              }}
            >
              {isMobileMenuOpen ? "Close" : "Menu"}
            </button>
            {isMobileMenuOpen ? (
              <div ref={mobileMenuPanelRef} id="admin-mobile-navigation" className={styles.mobileMenuPanel}>
                <Navigation
                  ariaLabel="Administration menu"
                  role={administrator.role}
                  permissions={administrator.permissions}
                  onNavigate={closeMobileMenuAfterNavigation}
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
