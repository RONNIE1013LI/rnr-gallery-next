"use client";
import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import styles from "./canvas-product-preview.module.css";
const RollUpBannerScene = dynamic(() => import("./roll-up-banner-scene"), { ssr: false, loading: () => <p role="status">Loading 3D preview…</p> });
export function RollUpBannerPreview({ imageSrc, children }: { imageSrc: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <div className={styles.preview}>
    {!open && children}
    <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Close 3D view" : "3D View"}</button>
    {open && <RollUpBannerScene key={imageSrc} imageSrc={imageSrc} />}
  </div>;
}
