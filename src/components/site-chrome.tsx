"use client";

import { usePathname } from "next/navigation";
import { ImageProtectionLayer } from "./image-protection";
import { SiteFooter, type SiteFooterContent } from "./site-footer";
import { SiteHeader } from "./site-header";

export function SiteChrome({
  children,
  footerContent,
}: Readonly<{ children: React.ReactNode; footerContent: SiteFooterContent }>) {
  const pathname = usePathname();
  const isDedicatedWorkspace = pathname === "/admin" || pathname.startsWith("/admin/")
    || pathname === "/forms" || pathname.startsWith("/forms/")
    || pathname === "/order-system" || pathname.startsWith("/order-system/");
  if (isDedicatedWorkspace) return children;
  return <>
    <ImageProtectionLayer />
    <SiteHeader />
    {children}
    <SiteFooter content={footerContent} />
  </>;
}
