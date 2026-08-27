"use client";

import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { classifyGa4Location, META_PIXEL_ID } from "@/domain/analytics/runtime";

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

export function MetaPixelController({
  production,
  enabled,
}: Readonly<{
  production: boolean;
  enabled: boolean;
}>) {
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const policy = classifyGa4Location(pathname, new URLSearchParams(search));
  const allowed = production && enabled && policy !== "private";
  const lastPageView = useRef<string | null>(null);

  useEffect(() => {
    clearMetaGates();
    if (!allowed) return;

    const root = document.documentElement;
    if (policy === "public") root.dataset.metaEnabled = "true";
    if (policy === "private-checkout") root.dataset.metaPrivateCommerce = "true";
    if (policy === "private-order") root.dataset.metaPrivatePurchase = "true";

    const fbq = ensureMetaPixelQueue();
    if (policy === "public" && lastPageView.current !== pathname) {
      lastPageView.current = pathname;
      fbq("trackSingle", META_PIXEL_ID, "PageView");
    }

    return () => clearMetaGates();
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
