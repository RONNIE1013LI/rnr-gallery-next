"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { THANK_YOU_OFFER_ENABLED } from "@/domain/promotions/thank-you-offer";
import type { Market } from "@/domain/markets/types";
import { useContainedDialog } from "./forms/use-contained-dialog";
import styles from "./homepage-promotion.module.css";


export function HomepagePromotion({ market = "NZ" }: Readonly<{ market?: Market }>) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!THANK_YOU_OFFER_ENABLED) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState === "hidden"
        || document.querySelector('[role="dialog"], [role="alertdialog"], .consent-preferences')) return;
      setOpen(true);
    }, 4_000);
    return () => window.clearTimeout(timer);
  }, []);

  useContainedDialog({
    active: open,
    dialogRef,
    isolationRootRef: backdropRef,
    initialFocusRef: closeRef,
    onClose: close,
  });

  if (!open) return null;

  return createPortal(
    <div
      ref={backdropRef}
      className={styles.backdrop}
      data-testid="promotion-backdrop"
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
    >
      <section
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="homepage-promotion-title"
        aria-describedby="homepage-promotion-description"
        tabIndex={-1}
      >
        <button ref={closeRef} className={styles.close} type="button" aria-label="Close promotion" onClick={close}>
          <span aria-hidden="true">×</span>
        </button>
        <h2 id="homepage-promotion-title" className={styles.srOnly}>Limited-time offer: save 36% in total</h2>
        <p id="homepage-promotion-description" className={styles.srOnly}>
          Sign up and sign in for 20% off your first order, automatically applied in your cart. No code needed. Returning customers: send your previous order number to our team
          to claim an extra 20% off the discounted price. For example, $100 becomes $80, then $64.
          Limited time only. Offer ends when this banner is removed.
        </p>
        <header className={styles.firstOrderNotice}>
          <p className={styles.firstOrderHeading}>FIRST ORDER: 20% OFF <strong className={styles.noCodeBadge}>NO CODE NEEDED</strong></p>
          <p>Sign up and sign in. Your 20% discount is automatically applied in your cart.</p>
        </header>
        <div className={styles.artwork}>
          <picture>
            <source media="(max-width: 640px)" srcSet="/media/promotions/thank-you-36-mobile.webp" width={1086} height={1448} />
            {/* Precompressed, art-directed assets; the browser downloads only the matching version. */}
            <img src="/media/promotions/thank-you-36-desktop.webp" alt="R&R Gallery limited-time canvas and banner offer" width={1670} height={941} />
          </picture>
          <div className={styles.actions} data-artwork-actions>
            <Link href={`/account/register?next=${encodeURIComponent(market === "AU" ? "/au/shop" : "/shop")}`} prefetch={false} onClick={close}><span className={styles.srOnly}>Sign up</span></Link>
            <a href="https://m.me/RandRgallery" rel="noopener noreferrer" onClick={close}><span className={styles.srOnly}>Message our team</span></a>
          </div>
        </div>
        <footer className={styles.footer}>
          <p>Returning customers: message our team with your previous order number to claim your account-bound voucher.</p>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
