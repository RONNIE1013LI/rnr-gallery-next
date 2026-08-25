"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ImageProtectionLayer } from "./image-protection";
import { CustomerChat } from "./customer-chat/customer-chat";
import { SiteFooter, type SiteFooterContent } from "./site-footer";
import { SiteHeader } from "./site-header";
import { CommerceIdentityProvider } from "./commerce-identity-provider";
import {
  australianCommerceDestination,
  marketSwitchDestination,
} from "@/domain/markets/market";
import type { Market } from "@/domain/markets/types";

type MarketTransition = Readonly<{
  market: Market;
  sourcePathname: string;
  targetPathname: string;
  settled: boolean;
}>;

function marketFromChangedEvent(event: Event): Market | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail: unknown = event.detail;
  if (!detail || typeof detail !== "object" || !("market" in detail)) return null;
  const market = detail.market;
  return market === "NZ" || market === "AU" ? market : null;
}

function explicitMarketForPathname(pathname: string): Market | null {
  if (pathname === "/au" || pathname.startsWith("/au/")) return "AU";
  return australianCommerceDestination(pathname) ? "NZ" : null;
}

export function SiteChrome({
  children,
  footerContent,
  footerLead = null,
  initialCustomerId = null,
  initialMarket = "NZ",
  australiaEnabled = false,
  customerChatEnabled = false,
}: Readonly<{
  children: React.ReactNode;
  footerContent: SiteFooterContent;
  footerLead?: React.ReactNode;
  initialCustomerId?: string | null;
  initialMarket?: Market;
  australiaEnabled?: boolean;
  customerChatEnabled?: boolean;
}>) {
  const pathname = usePathname();
  const [previousPathname, setPreviousPathname] = useState(pathname);
  const [selectedMarket, setSelectedMarket] = useState(initialMarket);
  const [marketTransition, setMarketTransition] = useState<MarketTransition | null>(null);
  if (pathname !== previousPathname) {
    setPreviousPathname(pathname);
    setMarketTransition((current) => {
      if (!current) return null;
      if (pathname === current.targetPathname) return { ...current, settled: true };
      if (!current.settled && pathname === current.sourcePathname) return current;
      return null;
    });
  }
  const isDedicatedWorkspace = pathname === "/admin" || pathname.startsWith("/admin/")
    || pathname === "/reply-assistant" || pathname.startsWith("/reply-assistant/")
    || pathname === "/forms" || pathname.startsWith("/forms/")
    || pathname === "/order-system" || pathname.startsWith("/order-system/");
  const activeOverride = marketTransition && (
    pathname === marketTransition.sourcePathname || pathname === marketTransition.targetPathname
  ) ? marketTransition : null;
  const effectiveOverride = activeOverride && (
    !activeOverride.settled || pathname === activeOverride.targetPathname
  ) ? activeOverride : null;
  const market: Market = effectiveOverride?.market
    ?? explicitMarketForPathname(pathname)
    ?? selectedMarket;
  const customerChatExcluded = pathname === "/admin" || pathname.startsWith("/admin/")
    || pathname === "/reply-assistant" || pathname.startsWith("/reply-assistant/")
    || pathname === "/forms" || pathname.startsWith("/forms/")
    || pathname === "/order-system" || pathname.startsWith("/order-system/")
    || pathname === "/checkout" || pathname.startsWith("/checkout/")
    || pathname === "/payment-return" || pathname.startsWith("/payment-return/")
    || pathname === "/payment/return" || pathname.startsWith("/payment/return/")
    || pathname === "/account" || pathname.startsWith("/account/")
    || pathname === "/orders" || pathname.startsWith("/orders/")
    || pathname === "/proof" || pathname.startsWith("/proof/")
    || pathname === "/proofs" || pathname.startsWith("/proofs/")
    || pathname === "/privacy" || pathname.startsWith("/privacy/")
    || pathname === "/privacy-policy" || pathname.startsWith("/privacy-policy/")
    || pathname === "/pay" || pathname.startsWith("/pay/");
  const suppressFooterLead = pathname === "/" || pathname === "/au"
    || pathname === "/account" || pathname.startsWith("/account/")
    || pathname === "/checkout" || pathname.startsWith("/checkout/")
    || pathname === "/orders" || pathname.startsWith("/orders/")
    || pathname === "/pay" || pathname.startsWith("/pay/")
    || pathname === "/reply-assistant" || pathname.startsWith("/reply-assistant/");
  useEffect(() => {
    function handleMarketChanged(event: Event) {
      const nextMarket = marketFromChangedEvent(event);
      if (nextMarket) {
        const targetPathname = marketSwitchDestination(pathname, nextMarket);
        setSelectedMarket(nextMarket);
        setMarketTransition({
          market: nextMarket,
          sourcePathname: pathname,
          targetPathname,
          settled: targetPathname === pathname,
        });
      }
    }

    window.addEventListener("rnr:market-changed", handleMarketChanged);
    return () => window.removeEventListener("rnr:market-changed", handleMarketChanged);
  }, [pathname]);
  if (isDedicatedWorkspace) return children;
  return (
    <CommerceIdentityProvider initialCustomerId={initialCustomerId}>
      <ImageProtectionLayer />
      <SiteHeader initialMarket={market} australiaEnabled={australiaEnabled} />
      {children}
      {!suppressFooterLead ? footerLead : null}
      <SiteFooter content={footerContent} market={market} />
      {customerChatEnabled && !customerChatExcluded ? <CustomerChat pathname={pathname} /> : null}
    </CommerceIdentityProvider>
  );
}
