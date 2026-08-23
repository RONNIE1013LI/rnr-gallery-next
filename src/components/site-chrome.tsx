"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ImageProtectionLayer } from "./image-protection";
import { SiteFooter, type SiteFooterContent } from "./site-footer";
import { SiteHeader } from "./site-header";
import { CommerceIdentityProvider } from "./commerce-identity-provider";
import { australianCommerceDestination } from "@/domain/markets/market";
import type { Market } from "@/domain/markets/types";

function marketFromChangedEvent(event: Event): Market | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail: unknown = event.detail;
  if (!detail || typeof detail !== "object" || !("market" in detail)) return null;
  const market = detail.market;
  return market === "NZ" || market === "AU" ? market : null;
}

export function SiteChrome({
  children,
  footerContent,
  footerLead = null,
  initialCustomerId = null,
  initialMarket = "NZ",
  australiaEnabled = false,
}: Readonly<{
  children: React.ReactNode;
  footerContent: SiteFooterContent;
  footerLead?: React.ReactNode;
  initialCustomerId?: string | null;
  initialMarket?: Market;
  australiaEnabled?: boolean;
}>) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [marketOverride, setMarketOverride] = useState<Market | null>(null);
  const isDedicatedWorkspace = pathname === "/admin" || pathname.startsWith("/admin/")
    || pathname === "/forms" || pathname.startsWith("/forms/")
    || pathname === "/order-system" || pathname.startsWith("/order-system/");
  const market: Market = marketOverride ?? (
    pathname === "/au" || pathname.startsWith("/au/") ? "AU" : initialMarket
  );
  const suppressFooterLead = pathname === "/" || pathname === "/au"
    || pathname === "/account" || pathname.startsWith("/account/")
    || pathname === "/checkout" || pathname.startsWith("/checkout/")
    || pathname === "/orders" || pathname.startsWith("/orders/")
    || pathname === "/pay" || pathname.startsWith("/pay/")
    || pathname === "/reply-assistant" || pathname.startsWith("/reply-assistant/");
  useEffect(() => {
    function handleMarketChanged(event: Event) {
      const nextMarket = marketFromChangedEvent(event);
      if (nextMarket) setMarketOverride(nextMarket);
    }

    window.addEventListener("rnr:market-changed", handleMarketChanged);
    return () => window.removeEventListener("rnr:market-changed", handleMarketChanged);
  }, []);
  useEffect(() => {
    if (marketOverride !== null || initialMarket !== "AU") return;
    const destination = australianCommerceDestination(pathname);
    if (destination && destination !== pathname) {
      const query = searchParams.toString();
      router.replace(`${destination}${query ? `?${query}` : ""}`);
    }
  }, [initialMarket, marketOverride, pathname, router, searchParams]);
  if (isDedicatedWorkspace) return children;
  return (
    <CommerceIdentityProvider initialCustomerId={initialCustomerId}>
      <ImageProtectionLayer />
      <SiteHeader initialMarket={market} australiaEnabled={australiaEnabled} />
      {children}
      {!suppressFooterLead ? footerLead : null}
      <SiteFooter content={footerContent} market={market} />
    </CommerceIdentityProvider>
  );
}
