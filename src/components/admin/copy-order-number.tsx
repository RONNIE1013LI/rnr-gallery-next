"use client";

import { useState } from "react";
import styles from "./admin.module.css";

export function CopyOrderNumber({ orderNumber }: Readonly<{ orderNumber: string }>) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(orderNumber);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  }
  return <button className={styles.copyButton} type="button" onClick={copy} aria-label={copied ? "Order number copied" : "Copy order number"}>{copied ? "Copied" : "Copy order number"}</button>;
}
