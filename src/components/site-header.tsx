import Link from "next/link";
import { BrandMark } from "./brand-mark";

const navigation = [
  { href: "/shop", label: "Shop" },
  { href: "/canvas", label: "Canvas" },
  { href: "/banners", label: "Banners" },
  { href: "/design-gallery", label: "Design Gallery" },
] as const;

function NavigationLinks() {
  return (
    <>
      {navigation.map((item) => (
        <Link key={item.href} href={item.href}>
          {item.label}
        </Link>
      ))}
    </>
  );
}

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="site-header__brand" href="/" aria-label="R&R Gallery home">
          <BrandMark />
        </Link>

        <nav className="site-header__nav" aria-label="Primary navigation">
          <NavigationLinks />
        </nav>

        <div className="site-header__actions">
          <Link className="site-header__account" href="/account">
            Account
          </Link>
          <Link className="site-header__cart" href="/cart" aria-label="Cart, 0 items">
            Cart <span aria-hidden="true">0</span>
          </Link>
          <details className="mobile-menu">
            <summary>Menu</summary>
            <nav aria-label="Mobile navigation">
              <NavigationLinks />
              <Link href="/account">Account</Link>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
