import Image from "next/image";
import Link from "next/link";
import { BrandMark } from "./brand-mark";

export type SiteFooterContent = Readonly<{
  tagline: string;
  email: string;
  phone: string;
}>;

const defaultContent: SiteFooterContent = Object.freeze({
  tagline:
    "Custom canvas, banners and print solutions, crafted with care in New Zealand.",
  email: "customerservice@rnrgallery.com",
  phone: "+64 21 023 48948",
});

const paymentLogos = Object.freeze([
  { name: "Visa", className: "visa" },
  { name: "Mastercard", className: "mastercard" },
  { name: "Afterpay", className: "afterpay" },
  { name: "Apple Pay", className: "apple-pay" },
  { name: "Google Pay", className: "google-pay" },
] as const);

function phoneHref(phone: string) {
  const normalized = phone.trim().replace(/(?!^\+)\D/g, "");
  return `tel:${normalized}`;
}

export function SiteFooter({ content = defaultContent }: Readonly<{ content?: SiteFooterContent }>) {
  return (
    <footer className="site-footer">
      <div className="site-footer__grid">
        <div className="site-footer__intro">
          <a className="site-footer__brand" href="#top" aria-label="R&R Gallery">
            <BrandMark imageSizes="(max-width: 560px) 88px, 72px" />
          </a>
          <p className="site-footer__tagline">{content.tagline}</p>
        </div>

        <div className="site-footer__column site-footer__shop">
          <p className="site-footer__title">Shop</p>
          <ul>
            <li><Link href="/shop">All products</Link></li>
            <li><Link href="/canvas">Canvas</Link></li>
            <li><Link href="/banners">Banners</Link></li>
          </ul>
        </div>

        <div className="site-footer__column site-footer__discover">
          <p className="site-footer__title">Discover</p>
          <ul>
            <li><Link href="/design-gallery">Gallery</Link></li>
            <li><Link href="/#gallery">Designs by Product</Link></li>
            <li><Link href="/#transformation">Transformations</Link></li>
            <li><Link href="/how-it-works">How It Works</Link></li>
            <li><Link href="/about">About</Link></li>
          </ul>
        </div>

        <div className="site-footer__column site-footer__customer">
          <p className="site-footer__title">Customer</p>
          <ul>
            <li><Link href="/account">My account</Link></li>
            <li><Link href="/cart">Cart</Link></li>
            <li><Link href="/privacy">Privacy</Link></li>
            <li><Link href="/terms">Terms</Link></li>
            <li><Link href="/shipping-delivery">Shipping &amp; Delivery</Link></li>
          </ul>
        </div>

        <div className="site-footer__column site-footer__help">
          <div className="site-footer__help-menu">
            <p className="site-footer__title">Need help?</p>
            <ul>
              <li><Link href="/help">FAQ</Link></li>
              <li><Link href="/contact">Contact</Link></li>
              <li>
                <a href="https://m.me/RandRgallery" rel="noopener noreferrer">
                  Message R&amp;R
                </a>
              </li>
            </ul>
            <address className="site-footer__contact">
              <a href={phoneHref(content.phone)}>{content.phone}</a>
              <a
                className="site-footer__email"
                href={`mailto:${content.email}`}
                aria-label={content.email}
              >
                <span className="site-footer__email-desktop">{content.email}</span>
                <span className="site-footer__email-mobile" aria-hidden="true">EMAIL</span>
              </a>
            </address>
          </div>
        </div>
      </div>

      <section
        className="site-footer__payments"
        aria-labelledby="site-footer-payments-title"
      >
        <p id="site-footer-payments-title" className="site-footer__payments-title">
          Accepted payments
        </p>
        <ul className="site-footer__payment-list">
          {paymentLogos.map((logo) => (
            <li className="site-footer__payment-logo" key={logo.name}>
              <span
                role="img"
                aria-label={logo.name}
                className={`site-footer__payment-mark site-footer__payment-mark--${logo.className}`}
              >
                <Image
                  src="/media/payments/footer-payment-methods.jpg"
                  alt=""
                  aria-hidden="true"
                  className="site-footer__payment-sprite"
                  width={1171}
                  height={100}
                  sizes="(max-width: 560px) 64px, 90px"
                  unoptimized
                />
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="site-footer__legal">
        <span
          className="site-footer__copyright"
          style={{ width: "100%", display: "block", margin: "0 auto", textAlign: "center" }}
        >
          © 2026 R&amp;R Gallery
        </span>
      </div>
    </footer>
  );
}
