"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { ImageProtectionLayer } from "./image-protection";
import { SiteFooter, type SiteFooterContent } from "./site-footer";
import { SiteHeader } from "./site-header";
import { CommerceIdentityProvider } from "./commerce-identity-provider";
import { australianCommerceDestination } from "@/domain/markets/market";
import type { Market } from "@/domain/markets/types";

export function SiteChrome({
  children,
  footerContent,
  initialCustomerId = null,
  initialMarket = "NZ",
  australiaEnabled = false,
}: Readonly<{
  children: React.ReactNode;
  footerContent: SiteFooterContent;
  initialCustomerId?: string | null;
  initialMarket?: Market;
  australiaEnabled?: boolean;
}>) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isDedicatedWorkspace = pathname === "/admin" || pathname.startsWith("/admin/")
    || pathname === "/forms" || pathname.startsWith("/forms/")
    || pathname === "/order-system" || pathname.startsWith("/order-system/");
  const market: Market = pathname === "/au" || pathname.startsWith("/au/")
    ? "AU"
    : initialMarket;
  useEffect(() => {
    if (initialMarket !== "AU") return;
    const destination = australianCommerceDestination(pathname);
    if (destination && destination !== pathname) {
      const query = searchParams.toString();
      router.replace(`${destination}${query ? `?${query}` : ""}`);
    }
  }, [initialMarket, pathname, router, searchParams]);
  if (isDedicatedWorkspace) return children;
  return (
    <CommerceIdentityProvider initialCustomerId={initialCustomerId}>
      <ImageProtectionLayer />
      <SiteHeader initialMarket={initialMarket} australiaEnabled={australiaEnabled} />
      {children}
      <SiteFooter content={footerContent} market={market} />
    </CommerceIdentityProvider>
  );
}
