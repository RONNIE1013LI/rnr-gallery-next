"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Cart } from "@/domain/cart/types";
import Link from "next/link";
import { marketSwitchDestination } from "@/domain/markets/market";
import type { Market } from "@/domain/markets/types";
import styles from "./market-switch-dialog.module.css";

const targetLabels: Readonly<Record<Market, string>> = {
  NZ: "New Zealand — NZD",
  AU: "Australia — AUD",
};

const focusableSelector = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export type MarketSwitchDialogState = Readonly<{
  targetMarket: Market;
  cart: Cart;
}>;

export function MarketSwitchDialog({ state, pending, onConfirm, onCancel }: Readonly<{
  state: MarketSwitchDialogState;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}>): ReactNode {
  const dialogRef = useRef<HTMLElement>(null);
  const pendingRef = useRef(pending);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    pendingRef.current = pending;
    onCancelRef.current = onCancel;
    if (pending) dialogRef.current?.focus();
  }, [onCancel, pending]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    (dialog?.querySelector<HTMLElement>(focusableSelector) ?? dialog)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!pendingRef.current) onCancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
      );
      if (controls.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!controls.includes(document.activeElement as HTMLElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className={styles.backdrop} role="presentation">
      <section
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby="market-switch-dialog-title"
        aria-describedby="market-switch-dialog-message"
      >
        <header className={styles.header}>
          <p className={styles.eyebrow}>Switching to {targetLabels[state.targetMarket]}</p>
          <h2 id="market-switch-dialog-title">Keep your configured cart</h2>
          <p id="market-switch-dialog-message" className={styles.message}>Your cart keeps its configured prices, production service and dates. To order for this country, edit each configuration. Your existing items stay in your cart.</p>
        </header>

        <div className={styles.issues}>
          {state.cart.items.map((item) => (
            <div className={styles.issue} key={item.id}>
              <strong>{item.productTitle}</strong>
              {pending ? <span>Edit configuration</span> : <Link
                aria-label={`Edit configuration for ${item.productTitle}`}
                onClick={onCancel}
                href={`${marketSwitchDestination(`/products/${item.productSlug}/configure`, state.targetMarket)}?${new URLSearchParams({ edit: item.id, size: item.sizeKey, ...(item.galleryDesignId ? { design: item.galleryDesignId } : {}) }).toString()}`}
              >Edit configuration</Link>}
            </div>
          ))}
        </div>

        <div className={styles.actions}>
          <button
            className={styles.primaryAction}
            type="button"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "Switching market…" : "Change browsing country"}
          </button>
          <button type="button" disabled={pending} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
