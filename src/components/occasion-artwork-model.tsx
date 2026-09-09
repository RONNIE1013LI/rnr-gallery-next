"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { PublicGalleryItem } from "@/server/gallery/public-gallery-service";
import { getCanvasProfile } from "./canvas-3d/profiles";
import styles from "./occasion-landing-page.module.css";

// The server-rendered optimized image remains the accessible, no-JS/error fallback.
export function OccasionArtworkModel({ item, children }: Readonly<{ item: Pick<PublicGalleryItem, "productTypeSlug" | "width" | "height">; children: ReactNode }>) {
  const host = useRef<HTMLDivElement>(null);
  const snapshot = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let alive = true;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      const source = element.querySelector("img");
      if (!source) return;
      const render = async () => {
        try {
          await source.decode();
          if (!alive) return;
          const { renderOccasionModel } = await import("./occasion-artwork-renderer");
          await renderOccasionModel(source, item, () => alive ? snapshot.current : null);
          if (alive) element.dataset.modelReady = "true";
        } catch {
          // Keep the original artwork if WebGL or its texture cannot be loaded.
        }
      };
      void render();
    }, { rootMargin: "100px" });
    observer.observe(element);
    return () => { alive = false; observer.disconnect(); };
  }, [item]);
  const canvasProfile = getCanvasProfile("a1", item.width >= item.height ? "landscape" : "portrait")!;
  const aspect = item.productTypeSlug === "grave-cover" ? .8 : item.productTypeSlug === "roll-up-banner" ? .6 : item.productTypeSlug === "wall-hanging-banners" ? 2 : canvasProfile.width / canvasProfile.height;
  return <div style={{ aspectRatio: aspect }} ref={host} className={styles.model} data-model-type={item.productTypeSlug}>
    {children}
    <canvas ref={snapshot} aria-hidden="true" className={styles.modelImage} />
  </div>;
}
