"use client";

import { useEffect } from "react";

const WATERMARK_TEXT = "R&R Gallery";

export function ImageProtectionLayer() {
  useEffect(() => {
    const timerRef = { current: 0 };

    const onContextMenu = (event: MouseEvent) => {
      const target = event.target;

      if (target instanceof HTMLImageElement || (target instanceof Element && target.closest("img"))) {
        event.preventDefault();
      }
    };

    const onDragStart = (event: DragEvent) => {
      if (event.target instanceof HTMLImageElement || (event.target instanceof Element && event.target.closest("img"))) {
        event.preventDefault();
      }
    };

    const overlay = document.getElementById("rnr-screenshot-overlay");
    if (!overlay) return;

    const triggerScreenshotMode = (durationMs = 5000) => {
      overlay.classList.add("is-active");
      window.clearTimeout(timerRef.current);

      timerRef.current = window.setTimeout(() => {
        overlay.classList.remove("is-active");
      }, durationMs);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const triggerByPrintScreen =
        event.key === "PrintScreen" ||
        ((event.metaKey || event.ctrlKey) && event.shiftKey && (event.key === "3" || event.key === "4"));

      if (triggerByPrintScreen) {
        triggerScreenshotMode();
      }
    };

    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("dragstart", onDragStart);
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(timerRef.current);
      overlay.classList.remove("is-active");
    };
  }, []);

  return (
    <div id="rnr-screenshot-overlay" className="imageProtectionOverlay" aria-hidden="true">
      <span>{WATERMARK_TEXT}</span>
      <span>{WATERMARK_TEXT}</span>
      <span>{WATERMARK_TEXT}</span>
      <span>{WATERMARK_TEXT}</span>
    </div>
  );
}
