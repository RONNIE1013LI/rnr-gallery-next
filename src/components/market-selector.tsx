"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Market } from "@/domain/markets/types";
import {
  clearIdentityCheckoutState,
  getActiveCustomerId,
} from "@/domain/cart/browser-cart-scope";

function destination(pathname: string, market: Market) {
  if (market === "NZ") {
    const stripped = pathname.replace(/^\/au(?=\/|$)/, "");
    return stripped || "/";
  }
  if (pathname === "/") return "/au";
  if (pathname.startsWith("/products/")) return `/au${pathname}`;
  return "/au";
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
  async function select(next: Market) {
    if (next === market) return;
    setPending(true);
    try {
      const response = await fetch("/api/market", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market: next }),
      });
      if (!response.ok) return;
      clearIdentityCheckoutState(
        window.localStorage,
        window.sessionStorage,
        getActiveCustomerId(),
      );
      window.dispatchEvent(new CustomEvent("rnr:market-changed", { detail: { market: next } }));
      router.push(destination(pathname, next));
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
        <option value="NZ">New Zealand — NZD</option>
        <option value="AU" disabled={!australiaEnabled}>Australia — AUD</option>
      </select>
    </label>
  );
}
