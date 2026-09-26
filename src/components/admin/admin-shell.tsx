"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

function isActiveDestination(pathname: string, href: string) {
  const normalizedPathname = pathname.replace(/\/+$/, "");
  return normalizedPathname === href || (href !== "/admin" && normalizedPathname.startsWith(`${href}/`));
}

function Navigation({ ariaLabel = "Administration", role, permissions, pathname, collapsible = false, onNavigate }: Readonly<{
  ariaLabel?: string;
  role: AdminRole;
  permissions: readonly AdminPermission[];
  pathname: string;
  collapsible?: boolean;
  onNavigate?: () => void;
}>) {
  const canOpen = (permission: AdminPermission) => hasAdminPermission(role, permissions, permission);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(() =>
    navigationGroups.find((group) => group.items.some((item) =>
      canOpen(item.permission) && isActiveDestination(pathname, item.href),
    ))?.label ?? null,
  );
  return (
    <nav className={styles.navigation} aria-label={ariaLabel}>
      {canOpen(dashboardNavigation.permission) ? (
        <Link className={styles.navigationHome} href={dashboardNavigation.href} onClick={onNavigate}
          aria-current={isActiveDestination(pathname, dashboardNavigation.href) ? "page" : undefined}>
          {dashboardNavigation.label}
        </Link>
      ) : null}
      {navigationGroups.map((group) => {
        const items = group.items.filter((item) => canOpen(item.permission));
        const expanded = !collapsible || expandedGroup === group.label;
        const groupId = `admin-mobile-group-${group.label.toLowerCase()}`;
        const links = items.map((item) => (
          <Link href={item.href} key={item.href} onClick={onNavigate}
            aria-current={isActiveDestination(pathname, item.href) ? "page" : undefined}>
            {item.label}
          </Link>
        ));
        return items.length ? (
          <div className={styles.navigationGroup} key={group.label}>
            {collapsible ? <>
              <button type="button" className={styles.navigationGroupToggle}
                aria-expanded={expanded} aria-controls={groupId}
                onClick={() => setExpandedGroup(expanded ? null : group.label)}>
                {group.label}<span aria-hidden="true">{expanded ? "−" : "+"}</span>
              </button>
              {expanded ? <div id={groupId} className={styles.navigationGroupItems}>{links}</div> : null}
            </> : <><span>{group.label}</span>{links}</>}
          </div>
        ) : null;
      })}
    </nav>
  );
}

function MobileMenu({ administrator, pathname }: Readonly<{
  administrator: AdminShellProps["administrator"];
  pathname: string;
}>) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
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
    const mobileViewport = window.matchMedia("(max-width: 900px)");
    const handleViewportChange = () => {
      if (!mobileViewport.matches) closeMobileMenuAfterNavigation();
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) closeMobileMenuAfterNavigation();
    };
    mobileViewport.addEventListener("change", handleViewportChange);
    window.addEventListener("popstate", closeMobileMenuAfterNavigation);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      mobileViewport.removeEventListener("change", handleViewportChange);
      window.removeEventListener("popstate", closeMobileMenuAfterNavigation);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [closeMobileMenuAfterNavigation]);

  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const dialog = dialogRef.current;
    const previousRootOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPadding = document.body.style.paddingRight;
    const bodyPadding = parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
    const previousWidth = document.documentElement.getBoundingClientRect().width;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    const releasedScrollbarWidth = document.documentElement.getBoundingClientRect().width - previousWidth;
    if (releasedScrollbarWidth > 0) document.body.style.paddingRight = `${bodyPadding + releasedScrollbarWidth}px`;
    dialog?.showModal();
    closeButtonRef.current?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      document.documentElement.style.overflow = previousRootOverflow;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.paddingRight = previousBodyPadding;
    };
  }, [isMobileMenuOpen]);

  useEffect(() => {
    if (!isMobileMenuOpen && restoreMobileMenuFocusRef.current) {
      mobileMenuTriggerRef.current?.focus();
      restoreMobileMenuFocusRef.current = false;
    }
  }, [isMobileMenuOpen]);

  return <div className={styles.mobileMenu}>
    <button ref={mobileMenuTriggerRef} type="button" aria-label="Open administration menu"
      aria-expanded={isMobileMenuOpen} aria-controls="admin-mobile-navigation"
      onClick={() => {
        if (!window.matchMedia("(max-width: 900px)").matches) return;
        restoreMobileMenuFocusRef.current = false;
        setIsMobileMenuOpen(true);
      }}><span className={styles.role}>Menu</span></button>
    {isMobileMenuOpen ? <dialog ref={dialogRef} id="admin-mobile-navigation"
      className={styles.mobileMenuPanel} aria-modal="true" aria-labelledby="admin-mobile-navigation-title"
      onClick={(event) => { if (event.target === event.currentTarget) closeMobileMenu(); }}
      onCancel={(event) => { event.preventDefault(); closeMobileMenu(); }}>
      <header className={styles.mobileMenuHeader}>
        <strong id="admin-mobile-navigation-title">Administration</strong>
        <button ref={closeButtonRef} type="button" aria-label="Close administration menu" onClick={closeMobileMenu}>Close</button>
      </header>
      <div className={styles.mobileMenuBody}>
        <Navigation ariaLabel="Administration menu" role={administrator.role} permissions={administrator.permissions}
          pathname={pathname} collapsible onNavigate={closeMobileMenuAfterNavigation} />
      </div>
    </dialog> : null}
  </div>;
}

export function AdminShell({ administrator, children }: AdminShellProps) {
  const pathname = usePathname();
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span>R&amp;R Gallery</span>
          <strong>Operations</strong>
        </div>
        <Navigation role={administrator.role} permissions={administrator.permissions} pathname={pathname} />
        <Link className={styles.publicLink} href="/">View storefront</Link>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <MobileMenu key={pathname} administrator={administrator} pathname={pathname} />
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
