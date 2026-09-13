"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MouseEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BrandMark } from "./brand-mark";
import { CartCount } from "./cart-count";
import { MarketSelector } from "./market-selector";
import type { Market } from "@/domain/markets/types";

const mobileNavigation = [
  { href: "/", label: "Home" },
  { href: "/shop", label: "Shop" },
  { href: "/canvas", label: "Canvas" },
  { href: "/banners", label: "Banners" },
  { href: "/design-gallery", label: "Design Gallery" },
  { href: "/#transformation", label: "Transformations" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/help", label: "Help" },
] as const;

const shopMenu = [
  { href: "/shop", label: "All products", detail: "Explore the complete collection" },
  { href: "/canvas", label: "Canvas", detail: "Photo, oil painting and themed canvas" },
  { href: "/banners", label: "Banners", detail: "Wall, roll-up and memorial formats" },
] as const;

const galleryMenu = [
  { href: "/design-gallery", label: "All designs", detail: "Browse every finished artwork" },
  { href: "/#gallery", label: "Designs by product", detail: "Canvas, wall banner, roll-up and grave cover" },
  { href: "/design-gallery?filters=1#browse-by-occasion", label: "Browse by occasion", detail: "Birthday, memorial, family and more" },
  { href: "/#transformation", label: "Transformations", detail: "See source photos become finished art" },
] as const;

function isCurrentRoute(pathname: string, href: string) {
  if (href.includes("#")) return false;
  if (href === "/" || href === "/au") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavigationLinks({
  items = mobileNavigation,
  onNavigate,
  pathname,
}: Readonly<{
  items?: readonly { href: string; label: string }[];
  onNavigate?: () => void;
  pathname: string;
}>) {
  return (
    <>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isCurrentRoute(pathname, item.href) ? "page" : undefined}
          onClick={onNavigate}
        >
          {item.label}
        </Link>
      ))}
    </>
  );
}

function DesktopMenu({
  href,
  label,
  items,
  pathname,
}: Readonly<{
  href: string;
  label: string;
  items: readonly { href: string; label: string; detail: string }[];
  pathname: string;
}>) {
  const [isDismissed, setIsDismissed] = useState(false);

  function releaseSiblingMenuFocus(event: MouseEvent<HTMLDivElement>) {
    const focusedElement = document.activeElement;
    const focusedMenu = focusedElement instanceof HTMLElement
      ? focusedElement.closest(".site-header__nav-group")
      : null;

    if (focusedMenu && focusedMenu !== event.currentTarget) {
      if (focusedElement instanceof HTMLElement) {
        focusedElement.blur();
      }
    }
  }

  function dismissMenu(event: MouseEvent<HTMLAnchorElement>) {
    event.currentTarget.blur();
    setIsDismissed(true);
  }

  return (
    <div
      className={`site-header__nav-group${isDismissed ? " site-header__nav-group--dismissed" : ""}`}
      onFocusCapture={() => setIsDismissed(false)}
      onMouseEnter={releaseSiblingMenuFocus}
      onMouseLeave={() => setIsDismissed(false)}
    >
      <Link
        className="site-header__nav-link site-header__nav-link--submenu"
        href={href}
        aria-current={isCurrentRoute(pathname, href) ? "page" : undefined}
        onClick={dismissMenu}
      >
        {label}
        <span className="site-header__nav-chevron" aria-hidden="true" />
      </Link>
      <nav
        className="site-header__submenu"
        aria-label={`${label} menu`}
        aria-hidden={isDismissed ? true : undefined}
      >
        <span className="site-header__submenu-kicker">{label}</span>
        {items.map((item) => (
          <Link
            key={`${item.href}-${item.label}`}
            href={item.href}
            aria-label={item.label}
            onClick={dismissMenu}
          >
            <span className="site-header__submenu-label">{item.label}</span>
            <span className="site-header__submenu-detail">{item.detail}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function SiteHeader({
  initialMarket = "NZ",
  australiaEnabled = false,
}: Readonly<{
  initialMarket?: Market;
  australiaEnabled?: boolean;
}>) {
  const pathname = usePathname();
  const market: Market = pathname === "/au" || pathname.startsWith("/au/")
    ? "AU"
    : initialMarket;
  const homeHref = market === "AU" ? "/au" : "/";
  const shopHref = market === "AU" ? "/au/shop" : "/shop";
  const visibleShopMenu = market === "AU"
    ? shopMenu.map((item) => ({ ...item, href: `/au${item.href}` }))
    : shopMenu;
  const visibleMobileNavigation = market === "AU"
    ? mobileNavigation
        .map((item) => item.label === "Home"
          ? { ...item, href: "/au" }
          : ["Shop", "Canvas", "Banners"].includes(item.label)
            ? { ...item, href: `/au${item.href}` }
          : item)
    : mobileNavigation;
  const mobileMenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenuDrawerRef = useRef<HTMLElement>(null);
  const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreMobileMenuFocusRef = useRef(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobileMenuClosing, setIsMobileMenuClosing] = useState(false);
  const [hasScrolled, setHasScrolled] = useState(false);
  const [isHeaderHidden, setIsHeaderHidden] = useState(false);

  const finishMobileMenuClose = useCallback(() => {
    if (mobileMenuCloseTimerRef.current) {
      clearTimeout(mobileMenuCloseTimerRef.current);
      mobileMenuCloseTimerRef.current = null;
    }
    setIsMobileMenuClosing(false);
    setIsMobileMenuOpen(false);
  }, []);

  const closeMobileMenuImmediately = useCallback(() => {
    restoreMobileMenuFocusRef.current = false;
    finishMobileMenuClose();
  }, [finishMobileMenuClose]);

  const closeMobileMenu = useCallback(() => {
    if (!isMobileMenuOpen || isMobileMenuClosing) return;
    restoreMobileMenuFocusRef.current = true;

    const prefersReducedMotion = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    setIsMobileMenuClosing(true);
    mobileMenuCloseTimerRef.current = setTimeout(
      finishMobileMenuClose,
      prefersReducedMotion ? 0 : 180,
    );
  }, [finishMobileMenuClose, isMobileMenuClosing, isMobileMenuOpen]);

  useEffect(() => () => {
    if (mobileMenuCloseTimerRef.current) {
      clearTimeout(mobileMenuCloseTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!isMobileMenuOpen) return;

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

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeMobileMenu, isMobileMenuOpen]);

  useEffect(() => {
    if (isMobileMenuOpen && !isMobileMenuClosing) {
      const drawer = mobileMenuDrawerRef.current;
      const currentPageLink = drawer?.querySelector<HTMLElement>('a[aria-current="page"]');
      (currentPageLink ?? drawer?.querySelector<HTMLElement>("a[href]"))?.focus();
    }
  }, [isMobileMenuClosing, isMobileMenuOpen]);

  useEffect(() => {
    if (!isMobileMenuOpen && restoreMobileMenuFocusRef.current) {
      mobileMenuTriggerRef.current?.focus();
      restoreMobileMenuFocusRef.current = false;
    }
  }, [isMobileMenuOpen]);

  useEffect(() => {
    let lastScrollY = Math.max(window.scrollY, 0);

    function syncScrolledState() {
      const currentScrollY = Math.max(window.scrollY, 0);
      const scrollDelta = currentScrollY - lastScrollY;

      setHasScrolled(currentScrollY > 8);

      if (isMobileMenuOpen || currentScrollY <= 8) {
        setIsHeaderHidden(false);
      } else if (scrollDelta > 2) {
        setIsHeaderHidden(true);
      } else if (scrollDelta < -2) {
        setIsHeaderHidden(false);
      }

      if (Math.abs(scrollDelta) > 2) {
        lastScrollY = currentScrollY;
      }
    }

    syncScrolledState();
    window.addEventListener("scroll", syncScrolledState, { passive: true });

    return () => window.removeEventListener("scroll", syncScrolledState);
  }, [isMobileMenuOpen]);

  return (
    <>
      <span id="top" className="page-top-anchor" aria-hidden="true" />
      <header
        className={`site-header site-header--sticky${hasScrolled ? " site-header--scrolled" : ""}${isHeaderHidden ? " site-header--hidden" : ""}${isMobileMenuOpen ? " site-header--menu-open" : ""}`}
      >
        <div className="site-header__inner">
          <Link
            className="site-header__brand"
            href={homeHref}
            aria-label="R&R Gallery Custom Prints NZ home"
            onClick={closeMobileMenuImmediately}
          >
            <BrandMark />
          </Link>

          <nav className="site-header__nav" aria-label="Primary navigation">
            <DesktopMenu href={shopHref} label="Shop" items={visibleShopMenu} pathname={pathname} />
            <DesktopMenu
              href="/design-gallery"
              label="Design Gallery"
              items={galleryMenu}
              pathname={pathname}
            />
            <Link className="site-header__nav-link" href="/how-it-works">How It Works</Link>
            <Link className="site-header__nav-link" href="/help">Help</Link>
          </nav>

          <div className="site-header__actions">
            <MarketSelector
              market={market}
              australiaEnabled={australiaEnabled}
              pathname={pathname}
            />
            <Link
              className="site-header__account"
              href="/account"
              aria-current={isCurrentRoute(pathname, "/account") ? "page" : undefined}
              onClick={closeMobileMenuImmediately}
            >
              Account
            </Link>
            <CartCount onClick={closeMobileMenuImmediately} />
            <Link
              className="site-header__start-design"
              href={shopHref}
              onClick={closeMobileMenuImmediately}
            >
              Start a Design
            </Link>
            <div ref={mobileMenuRef} className={`mobile-menu${isMobileMenuOpen ? " mobile-menu--open" : ""}${isMobileMenuClosing ? " mobile-menu--closing" : ""}`}>
              <button
                ref={mobileMenuTriggerRef}
                type="button"
                aria-label={isMobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
                aria-expanded={isMobileMenuOpen}
                aria-controls="mobile-navigation-drawer"
                onClick={() => {
                  if (isMobileMenuOpen) {
                    closeMobileMenu();
                  } else {
                    restoreMobileMenuFocusRef.current = false;
                    setIsMobileMenuOpen(true);
                  }
                }}
              >
                <span className="mobile-menu__icon" aria-hidden="true">
                  <span className="mobile-menu__icon-line" />
                  <span className="mobile-menu__icon-line" />
                  <span className="mobile-menu__icon-line" />
                  <span className="mobile-menu__icon-line" />
                </span>
                <span className="mobile-menu__label">
                  {isMobileMenuOpen ? "Close" : "Menu"}
                </span>
              </button>
              {isMobileMenuOpen ? (
                <>
                  <button
                    className="mobile-menu__backdrop"
                    type="button"
                    tabIndex={-1}
                    aria-label="Close mobile navigation"
                    onClick={closeMobileMenu}
                  />
                  <nav
                    ref={mobileMenuDrawerRef}
                    id="mobile-navigation-drawer"
                    className="mobile-menu__drawer"
                    aria-label="Mobile navigation"
                  >
                    <NavigationLinks
                      items={visibleMobileNavigation}
                      pathname={pathname}
                      onNavigate={closeMobileMenuImmediately}
                    />
                    <Link
                      href="/account"
                      aria-current={isCurrentRoute(pathname, "/account") ? "page" : undefined}
                      onClick={closeMobileMenuImmediately}
                    >
                      Account
                    </Link>
                    <Link
                      className="mobile-menu__start-design"
                      href={shopHref}
                      onClick={closeMobileMenuImmediately}
                    >
                      Start a Design
                    </Link>
                  </nav>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </header>
    </>
  );
}
