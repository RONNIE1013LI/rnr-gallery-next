"use client";

import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import type { Orientation } from "@/domain/configuration/types";
import { getCanvasProfile } from "./canvas-3d/profiles";
import styles from "./canvas-product-preview.module.css";

const CanvasProductScene = dynamic(() => import("./canvas-product-scene"), {
  ssr: false,
  loading: () => <p role="status">Loading 3D preview…</p>,
});
export type CanvasPreviewProps = { imageSrc: string; sizeKey: string; orientation?: Orientation; sizes?: readonly string[]; children?: ReactNode };
export function CanvasProductPreview({ imageSrc, sizeKey, orientation, sizes, children }: CanvasPreviewProps) {
  const [open, setOpen] = useState(false);
  const [previewSize, setPreviewSize] = useState(sizeKey);
  const activeSize = sizes?.includes(previewSize) ? previewSize : sizeKey;
  if (!getCanvasProfile(activeSize, orientation)) return <>{children}</>;
  return <div className={styles.preview}>
    {!open && children}
    <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen(!open)}>
      {open ? "Close 3D view" : "3D View"}
    </button>
    {open && sizes && <label className={styles.sizeSelect}>Preview size
      <select value={activeSize} onChange={event=>setPreviewSize(event.target.value)}>
        {sizes.filter(key=>getCanvasProfile(key,orientation)).map(key=><option key={key} value={key}>{key.toUpperCase()}</option>)}
      </select>
    </label>}
    {open && <CanvasProductScene imageSrc={imageSrc} sizeKey={activeSize} orientation={orientation} />}
  </div>;
}
