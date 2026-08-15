"use client";

import { usePathname } from "next/navigation";
import { ImageProtectionLayer } from "./image-protection";
import { SiteFooter, type SiteFooterContent } from "./site-footer";
import { SiteHeader } from "./site-header";
import { CommerceIdentityProvider } from "./commerce-identity-provider";
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
  const isDedicatedWorkspace = pathname === "/admin" || pathname.startsWith("/admin/")
    || pathname === "/forms" || pathname.startsWith("/forms/")
    || pathname === "/order-system" || pathname.startsWith("/order-system/");
  if (isDedicatedWorkspace) return children;
  return (
    <CommerceIdentityProvider initialCustomerId={initialCustomerId}>
      <ImageProtectionLayer />
      <SiteHeader initialMarket={initialMarket} australiaEnabled={australiaEnabled} />
      {children}
      <SiteFooter content={footerContent} />
    </CommerceIdentityProvider>
  );
}
