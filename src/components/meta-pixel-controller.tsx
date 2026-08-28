"use client";

import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { classifyGa4Location, META_PIXEL_ID } from "@/domain/analytics/runtime";
import { emitMetaAnalyticsEvent, emitMetaPageView } from "@/domain/analytics/meta";
import { useAdvertisingConsent } from "./consent-preferences";

type MetaPixelQueue = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  loaded: boolean;
  push: MetaPixelQueue;
  version: string;
};
type MetaWindow = Window & {
  fbq?: MetaPixelQueue;
  _fbq?: MetaPixelQueue;
};

function ensureMetaPixelQueue(): MetaPixelQueue {
  const metaWindow = window as MetaWindow;
  if (typeof metaWindow.fbq === "function") return metaWindow.fbq;
  const queue = ((...args: unknown[]) => {
    if (queue.callMethod) queue.callMethod(...args);
    else queue.queue.push(args);
  }) as unknown as MetaPixelQueue;
  queue.queue = [];
  queue.loaded = true;
  queue.push = queue;
  queue.version = "2.0";
  metaWindow.fbq = queue;
  metaWindow._fbq = queue;
  queue("init", META_PIXEL_ID);
  return queue;
}

function clearMetaGates() {
  const root = document.documentElement;
  root.removeAttribute("data-meta-enabled");
  root.removeAttribute("data-meta-private-commerce");
  root.removeAttribute("data-meta-private-purchase");
  root.removeAttribute("data-meta-loaded");
}

function contactMethod(link: HTMLAnchorElement): "messenger" | "whatsapp" | "email" | null {
  const href = link.getAttribute("href")?.trim() ?? "";
  if (href.toLowerCase().startsWith("mailto:")) return "email";
  try {
    const hostname = new URL(href, window.location.origin).hostname.toLowerCase();
    if (hostname === "m.me" || hostname === "messenger.com" || hostname.endsWith(".messenger.com")) {
      return "messenger";
    }
    if (hostname === "wa.me" || hostname === "whatsapp.com" || hostname.endsWith(".whatsapp.com")) {
      return "whatsapp";
    }
  } catch {
    // Invalid links are not analytics events.
  }
  return null;
}

export function MetaPixelController({
  production,
  enabled,
}: Readonly<{
  production: boolean;
  enabled: boolean;
}>) {
  const consent = useAdvertisingConsent();
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const policy = classifyGa4Location(pathname, new URLSearchParams(search));
  const allowed = production && enabled && consent?.advertising === true && policy === "public";
  const lastPageView = useRef<string | null>(null);

  useEffect(() => {
    clearMetaGates();
    if (!allowed) {
      const fbq = (window as MetaWindow).fbq;
      if (typeof fbq === "function") fbq("consent", "revoke");
      return;
    }

    const root = document.documentElement;
    root.dataset.metaEnabled = "true";

    ensureMetaPixelQueue();
    const handleContactClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.dataset.rnrMetaContactTracked === "true") return;
      const method = contactMethod(link);
      if (!method) return;
      emitMetaAnalyticsEvent({ event: "messenger_click", location: `contact:${method}` });
    };
    document.addEventListener("click", handleContactClick);
    if (lastPageView.current !== pathname) {
      lastPageView.current = pathname;
      emitMetaPageView(pathname);
    }

    return () => {
      document.removeEventListener("click", handleContactClick);
      clearMetaGates();
    };
  }, [allowed, pathname, policy, search]);

  if (!allowed) return null;
  return (
    <Script
      id="rnr-meta-pixel"
      src="https://connect.facebook.net/en_US/fbevents.js"
      strategy="afterInteractive"
      onLoad={() => {
        document.documentElement.dataset.metaLoaded = "true";
      }}
    />
  );
}
