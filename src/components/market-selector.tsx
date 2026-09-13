"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LuChevronDown } from "react-icons/lu";
import type { Market } from "@/domain/markets/types";
import {
  clearIdentityCheckoutState,
  getActiveCustomerId,
} from "@/domain/cart/browser-cart-scope";
import { createBrowserCartRepository } from "@/domain/cart/browser-cart-repository";
import { marketSwitchDestination } from "@/domain/markets/market";
import { requestMarketSwitch } from "@/domain/markets/browser-market-switch";
import {
  MarketSwitchDialog,
  type MarketSwitchDialogState,
} from "./market-switch-dialog";
import dialogStyles from "./market-switch-dialog.module.css";

export function MarketSelector({
  market,
  australiaEnabled,
  pathname,
  ariaLabel = "Country and currency",
  onMarketChanged,
}: Readonly<{
  market: Market;
  australiaEnabled: boolean;
  pathname: string;
  ariaLabel?: string;
  onMarketChanged?: () => void;
}>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const selectorRef = useRef<HTMLSelectElement>(null);
  const dialogWasOpenRef = useRef(false);
  const dialogIdentityRef = useRef<string | null>(null);
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

  async function runSwitch(next: Market) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    const initiatingCustomerId = getActiveCustomerId();
    setPending(true);
    setError(null);
    try {
      const result = await requestMarketSwitch({
        market: next,
        persistPreference: true,
      });
      if (getActiveCustomerId() !== initiatingCustomerId) {
        setDialogState(null);
        return;
      }
      if (!result.ok) {
        setDialogState(null);
        setError("error" in result.payload ? result.payload.error : "The market could not be changed.");
        return;
      }

      clearIdentityCheckoutState(
        window.localStorage,
        window.sessionStorage,
        initiatingCustomerId,
      );
      window.dispatchEvent(new CustomEvent("rnr:market-changed", { detail: { market: next } }));
      onMarketChanged?.();
      setDialogState(null);
      const destination = marketSwitchDestination(pathname, next);
      if (destination === pathname) router.refresh();
      else router.push(destination);
    } catch {
      setDialogState(null);
      if (getActiveCustomerId() === initiatingCustomerId) {
        setError("The market could not be changed.");
      }
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  function select(next: Market) {
    if (next === market || pendingRef.current) return;
    const repository = createBrowserCartRepository(window.localStorage);
    const cart = repository.load();
    if (cart.items.length > 0) {
      setError(null);
      dialogIdentityRef.current = getActiveCustomerId();
      setDialogState({ targetMarket: next, cart });
    } else {
      void runSwitch(next);
    }
  }

  function confirmCountry() {
    if (!dialogState || pendingRef.current) return;
    if (dialogIdentityRef.current !== getActiveCustomerId()) {
      setDialogState(null);
      return;
    }
    void runSwitch(dialogState.targetMarket);
  }

  function cancelDialog() {
    if (!pendingRef.current) setDialogState(null);
  }

  return (
    <>
      <label className="site-header__market">
        <span className="sr-only">{ariaLabel}</span>
        <select
          ref={selectorRef}
          aria-label={ariaLabel}
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
          onConfirm={confirmCountry}
          onCancel={cancelDialog}
        />
      ) : null}
    </>
  );
}
