"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LuChevronDown } from "react-icons/lu";
import type { Market, MarketCurrency } from "@/domain/markets/types";
import {
  clearIdentityCheckoutState,
  getActiveCustomerId,
} from "@/domain/cart/browser-cart-scope";
import { createBrowserCartRepository } from "@/domain/cart/browser-cart-repository";
import { cartToCheckoutInput } from "@/domain/cart/checkout-input";
import { applyAuthoritativeRepricing } from "@/domain/cart/cart";
import type { RepricedCheckoutCart } from "@/domain/checkout/types";
import { notifyCartChanged } from "@/domain/cart/browser-cart-events";
import { marketSwitchDestination } from "@/domain/markets/market";
import type { Cart } from "@/domain/cart/types";
import type { MarketSwitchUrgentIssue } from "@/domain/checkout/market-switch-preflight";
import {
  MarketSwitchDialog,
  type MarketSwitchDialogState,
} from "./market-switch-dialog";
import dialogStyles from "./market-switch-dialog.module.css";

type MarketRoutePayload =
  | Readonly<{
      market: Market;
      currency: MarketCurrency;
      cart?: RepricedCheckoutCart;
    }>
  | Readonly<{
      error: string;
      code:
        | "unsupported_market"
        | "market_unavailable"
        | "urgent_confirmation_required"
        | "invalid_cart"
        | "market_switch_failed";
      issues?: readonly MarketSwitchUrgentIssue[];
    }>;

async function attemptSwitch(next: Market, candidateCart: Cart) {
  const response = await fetch("/api/market", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      market: next,
      ...(candidateCart.items.length > 0
        ? { cart: cartToCheckoutInput(candidateCart) }
        : {}),
    }),
  });
  const payload = await response.json() as MarketRoutePayload;
  if (!response.ok) return { ok: false as const, payload };
  if (candidateCart.items.length > 0 && !("cart" in payload && payload.cart)) {
    return {
      ok: false as const,
      payload: {
        error: "The repriced cart was missing.",
        code: "market_switch_failed" as const,
      },
    };
  }
  return { ok: true as const, payload };
}

export function MarketSelector({
  market,
  australiaEnabled,
  pathname,
}: Readonly<{
  market: Market;
  australiaEnabled: boolean;
  pathname: string;
}>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const selectorRef = useRef<HTMLSelectElement>(null);
  const dialogWasOpenRef = useRef(false);
  const [useMobileLabels, setUseMobileLabels] = useState(false);
  const [dialogState, setDialogState] = useState<MarketSwitchDialogState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 560px)");
    const syncLabels = () => setUseMobileLabels(query.matches);
    syncLabels();
    query.addEventListener?.("change", syncLabels);
    return () => query.removeEventListener?.("change", syncLabels);
  }, []);

  useEffect(() => {
    if (dialogState) {
      dialogWasOpenRef.current = true;
    } else if (dialogWasOpenRef.current) {
      dialogWasOpenRef.current = false;
      selectorRef.current?.focus();
    }
  }, [dialogState]);

  async function runSwitch(next: Market, candidateCart: Cart) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const repository = createBrowserCartRepository(window.localStorage);
      const result = await attemptSwitch(next, candidateCart);
      if (!result.ok) {
        const payload = result.payload;
        if (
          "code" in payload &&
          payload.code === "urgent_confirmation_required" &&
          payload.issues?.length
        ) {
          setDialogState({
            targetMarket: next,
            cart: candidateCart,
            issues: payload.issues,
            message: payload.error,
          });
        } else {
          setDialogState(null);
          setError("error" in payload ? payload.error : "The market could not be changed.");
        }
        return;
      }

      const payload = result.payload;
      if (candidateCart.items.length > 0 && "cart" in payload && payload.cart) {
        repository.save(applyAuthoritativeRepricing(candidateCart, payload.cart));
        notifyCartChanged();
      }
      clearIdentityCheckoutState(
        window.localStorage,
        window.sessionStorage,
        getActiveCustomerId(),
      );
      window.dispatchEvent(new CustomEvent("rnr:market-changed", { detail: { market: next } }));
      setDialogState(null);
      router.push(marketSwitchDestination(pathname, next));
    } catch {
      setDialogState(null);
      setError("The market could not be changed.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  function select(next: Market) {
    if (next === market || pendingRef.current) return;
    const repository = createBrowserCartRepository(window.localStorage);
    void runSwitch(next, repository.load());
  }

  function changeDate(clientItemId: string, neededDate: string) {
    setDialogState((current) => current ? {
      ...current,
      cart: {
        version: 1,
        items: current.cart.items.map((item) => item.id === clientItemId
          ? { ...item, neededDate, urgentServiceConfirmed: false }
          : item),
      },
    } : null);
  }

  function confirmUrgent() {
    if (!dialogState || pendingRef.current) return;
    const urgentIds = new Set(dialogState.issues.map((issue) => issue.clientItemId));
    const confirmedCart: Cart = {
      version: 1,
      items: dialogState.cart.items.map((item) => urgentIds.has(item.id)
        ? { ...item, urgentServiceConfirmed: true }
        : item),
    };
    void runSwitch(dialogState.targetMarket, confirmedCart);
  }

  function tryDates() {
    if (!dialogState || pendingRef.current) return;
    void runSwitch(dialogState.targetMarket, dialogState.cart);
  }

  function cancelDialog() {
    if (!pendingRef.current) setDialogState(null);
  }

  return (
    <>
      <label className="site-header__market">
        <span className="sr-only">Country and currency</span>
        <select
          ref={selectorRef}
          aria-label="Country and currency"
          value={market}
          disabled={pending}
          onChange={(event) => select(event.target.value as Market)}
        >
          <option value="NZ">{useMobileLabels ? "New Zealand" : "New Zealand — NZD"}</option>
          <option value="AU" disabled={!australiaEnabled}>{useMobileLabels ? "Australia" : "Australia — AUD"}</option>
        </select>
        <LuChevronDown aria-hidden="true" className="site-header__market-icon" />
      </label>
      {error ? <p className={dialogStyles.selectorError} role="alert">{error}</p> : null}
      {dialogState ? (
        <MarketSwitchDialog
          state={dialogState}
          pending={pending}
          onDateChange={changeDate}
          onConfirmUrgent={confirmUrgent}
          onTryDates={tryDates}
          onCancel={cancelDialog}
        />
      ) : null}
    </>
  );
}
