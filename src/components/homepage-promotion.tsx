"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
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
    const controller = new AbortController();
    let active = true;
    const enabled = fetch("/api/promotions/thank-you-offer", { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok && (await response.json()).enabled === true)
      .catch(() => false);
    const timer = window.setTimeout(async () => {
      if (!await enabled || !active) return;
      if (document.visibilityState === "hidden"
        || document.querySelector('[role="dialog"], [role="alertdialog"], .consent-preferences')) return;
      setOpen(true);
    }, 4_000);
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
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
        <header className={styles.firstOrderNotice}>
          <h2 id="homepage-promotion-title" className={styles.firstOrderHeading}>Anniversary offer: 20% off <strong className={styles.noCodeBadge}>No code needed</strong></h2>
          <p id="homepage-promotion-description">The anniversary discount is applied automatically to eligible merchandise and customisation during the promotion. Shipping and urgent fees are excluded.</p>
        </header>
        <div className={styles.actions}>
          <Link href={`/account/register?next=${encodeURIComponent(market === "AU" ? "/au/shop" : "/shop")}`} prefetch={false} onClick={close}>Sign up</Link>
          <a href="https://m.me/RandRgallery" rel="noopener noreferrer" onClick={close}>Message our team</a>
        </div>
      </section>
    </div>,
    document.body,
  );
}
