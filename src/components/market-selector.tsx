"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LuChevronDown } from "react-icons/lu";
import type { Market } from "@/domain/markets/types";
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
  const [useMobileLabels, setUseMobileLabels] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 560px)");
    const syncLabels = () => setUseMobileLabels(query.matches);
    syncLabels();
    query.addEventListener?.("change", syncLabels);
    return () => query.removeEventListener?.("change", syncLabels);
  }, []);

  async function select(next: Market) {
    if (next === market) return;
    setPending(true);
    try {
      const repository = createBrowserCartRepository(window.localStorage);
      const activeCart = repository.load();
      const response = await fetch("/api/market", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          market: next,
          ...(activeCart.items.length > 0 ? { cart: cartToCheckoutInput(activeCart) } : {}),
        }),
      });
      if (!response.ok) return;
      const payload = await response.json() as { cart?: RepricedCheckoutCart };
      if (activeCart.items.length > 0) {
        if (!payload.cart) return;
        repository.save(applyAuthoritativeRepricing(activeCart, payload.cart));
        notifyCartChanged();
      }
      clearIdentityCheckoutState(
        window.localStorage,
        window.sessionStorage,
        getActiveCustomerId(),
      );
      window.dispatchEvent(new CustomEvent("rnr:market-changed", { detail: { market: next } }));
      router.push(marketSwitchDestination(pathname, next));
      router.refresh();
    } finally {
      setPending(false);
    }
  }
  return (
    <label className="site-header__market">
      <span className="sr-only">Country and currency</span>
      <select
        aria-label="Country and currency"
        value={market}
        disabled={pending}
        onChange={(event) => void select(event.target.value as Market)}
      >
        <option value="NZ">{useMobileLabels ? "New Zealand" : "New Zealand — NZD"}</option>
        <option value="AU" disabled={!australiaEnabled}>{useMobileLabels ? "Australia" : "Australia — AUD"}</option>
      </select>
      <LuChevronDown aria-hidden="true" className="site-header__market-icon" />
    </label>
  );
}
