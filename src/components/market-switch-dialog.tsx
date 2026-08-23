"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Cart } from "@/domain/cart/types";
import type { MarketSwitchUrgentIssue } from "@/domain/checkout/market-switch-preflight";
import type { Market } from "@/domain/markets/types";
import { formatMarketMoney } from "@/domain/money";
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
  issues: readonly MarketSwitchUrgentIssue[];
  message: string;
}>;

export function MarketSwitchDialog({
  state,
  pending,
  onDateChange,
  onConfirmUrgent,
  onTryDates,
  onCancel,
}: Readonly<{
  state: MarketSwitchDialogState;
  pending: boolean;
  onDateChange: (clientItemId: string, neededDate: string) => void;
  onConfirmUrgent: () => void;
  onTryDates: () => void;
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
          <h2 id="market-switch-dialog-title">Review urgent service</h2>
          <p id="market-switch-dialog-message" className={styles.message}>{state.message}</p>
        </header>

        <div className={styles.issues}>
          {state.issues.map((issue) => {
            const neededDate = state.cart.items.find(
              (item) => item.id === issue.clientItemId,
            )?.neededDate ?? "";
            return (
              <label className={styles.issue} key={issue.clientItemId}>
                <span className={styles.issueSummary}>
                  <strong>{issue.productTitle}</strong>
                  <span>{formatMarketMoney(issue.urgentFeeInclGstCents, issue.currency)}</span>
                </span>
                <span className={styles.dateLabel}>Completion date</span>
                <input
                  aria-label={`Completion date for ${issue.productTitle}`}
                  type="date"
                  value={neededDate}
                  disabled={pending}
                  onChange={(event) => onDateChange(issue.clientItemId, event.target.value)}
                />
                <small>{issue.urgentWorkingDays} working days</small>
              </label>
            );
          })}
        </div>

        <div className={styles.actions}>
          <button
            className={styles.primaryAction}
            type="button"
            disabled={pending}
            onClick={onConfirmUrgent}
          >
            {pending ? "Switching market…" : "Confirm urgent service and switch"}
          </button>
          <button type="button" disabled={pending} onClick={onTryDates}>
            Try these dates
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
