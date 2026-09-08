"use client";
import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import styles from "./canvas-product-preview.module.css";
const FabricBannerScene = dynamic(() => import("./fabric-banner-scene"), { ssr: false, loading: () => <p role="status">Loading 3D preview…</p> });
export function FabricBannerPreview({ imageSrc, productSlug, sizeKey, children }: { imageSrc: string; productSlug?: string; sizeKey?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const grave = productSlug === "grave-cover";
  const width = grave ? 1 : sizeKey === "300x150" ? 3 : sizeKey === "200x100" ? 2 : 1.6;
  const height = grave ? 2 : width / 2;
  return <div className={styles.preview}>
    {!open && children}
    <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Close 3D view" : "3D View"}</button>
    {open && <FabricBannerScene key={`${imageSrc}-${width}`} imageSrc={imageSrc} kind={grave ? "grave" : "wall"} width={width} height={height} />}
  </div>;
}
