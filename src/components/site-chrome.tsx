"use client";

import { usePathname } from "next/navigation";
import { ImageProtectionLayer } from "./image-protection";
import { SiteFooter, type SiteFooterContent } from "./site-footer";
import { SiteHeader } from "./site-header";
import { CommerceIdentityProvider } from "./commerce-identity-provider";

export function SiteChrome({
  children,
  footerContent,
  initialCustomerId = null,
}: Readonly<{
  children: React.ReactNode;
  footerContent: SiteFooterContent;
  initialCustomerId?: string | null;
}>) {
  const pathname = usePathname();
  const isDedicatedWorkspace = pathname === "/admin" || pathname.startsWith("/admin/")
    || pathname === "/forms" || pathname.startsWith("/forms/")
    || pathname === "/order-system" || pathname.startsWith("/order-system/");
  if (isDedicatedWorkspace) return children;
  return (
    <CommerceIdentityProvider initialCustomerId={initialCustomerId}>
      <ImageProtectionLayer />
      <SiteHeader />
      {children}
      <SiteFooter content={footerContent} />
    </CommerceIdentityProvider>
  );
}
