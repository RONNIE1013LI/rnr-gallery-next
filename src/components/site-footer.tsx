import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__grid">
        <div className="site-footer__intro">
          <p className="site-footer__title">R&amp;R Gallery</p>
          <p>
            Custom canvas, banners and print solutions, crafted with care in New
            Zealand.
          </p>
        </div>

        <div>
          <p className="site-footer__title">Explore</p>
          <ul>
            <li><Link href="/shop">All products</Link></li>
            <li><Link href="/design-gallery">Design gallery</Link></li>
            <li><Link href="/canvas">Canvas</Link></li>
            <li><Link href="/banners">Banners</Link></li>
          </ul>
        </div>

        <div>
          <p className="site-footer__title">Customer</p>
          <ul>
            <li><Link href="/account">My account</Link></li>
            <li><Link href="/how-it-works">How it works</Link></li>
            <li><Link href="/cart">Cart</Link></li>
          </ul>
        </div>

        <div>
          <p className="site-footer__title">Need help?</p>
          <ul>
            <li>
              <a href="https://m.me/RandRgallery" rel="noopener noreferrer">
                Message R&amp;R
              </a>
            </li>
            <li><a href="tel:+642102348948">+64 21 023 48948</a></li>
            <li>
              <a href="mailto:customerservice@rnrgallery.com">
                customerservice@rnrgallery.com
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="site-footer__legal">
        <span>© 2026 R&amp;R Gallery</span>
        <span>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </span>
      </div>
    </footer>
  );
}
