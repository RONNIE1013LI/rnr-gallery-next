"use client";

import { useEffect, useRef, useState } from "react";

import { ProductionJobForm } from "@/components/admin/production-job-form";
import { ResizableSeparator } from "@/components/shared/resizable-separator";
import type { FormsOrderEntryData } from "./forms-workbench";
import styles from "./forms.module.css";
import { useContainedDialog } from "./use-contained-dialog";

function drawerSize(viewportWidth: number) {
  const visibleListWidth = viewportWidth <= 700 ? 20 : 280;
  const max = Math.max(0, viewportWidth - visibleListWidth);
  const min = Math.min(520, max);
  return {
    min,
    max,
    initial: Math.min(max, Math.max(min, Math.round(viewportWidth * 0.72))),
  };
}

export function FormsOrderEntryDrawer({
  data,
  onClose,
}: Readonly<{
  data: FormsOrderEntryData;
  onClose: () => void;
}>) {
  const serverSize = drawerSize(1_200);
  const [limits, setLimits] = useState({ min: serverSize.min, max: serverSize.max });
  const [width, setWidth] = useState(serverSize.initial);
  const [dirty, setDirty] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function fitToViewport() {
      const next = drawerSize(window.innerWidth);
      setLimits({ min: next.min, max: next.max });
      setWidth((current) => Math.min(next.max, Math.max(next.min, current === serverSize.initial ? next.initial : current)));
    }
    fitToViewport();
    window.addEventListener("resize", fitToViewport);
    return () => window.removeEventListener("resize", fitToViewport);
  }, [serverSize.initial]);

  function close() {
    if (dirty && !window.confirm("Discard this unsaved manual order?")) return;
    onClose();
  }

  useContainedDialog({
    active: true,
    dialogRef,
    initialFocusRef: closeButtonRef,
    isolationRootRef: backdropRef,
    onClose: close,
  });

  return (
    <div ref={backdropRef} className={styles.drawerBackdrop} onMouseDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <div
        ref={dialogRef}
        className={styles.orderEntryDrawer}
        role="dialog"
        aria-modal="true"
        aria-label="Order entry"
        tabIndex={-1}
        style={{ "--entry-drawer-width": `${width}px` } as React.CSSProperties}
      >
        <ResizableSeparator
          className={styles.orderEntryResizeHandle}
          label="Resize order entry"
          value={width}
          min={limits.min}
          max={limits.max}
          step={20}
          direction={-1}
          onChange={setWidth}
        />
        <div className={styles.orderEntryDrawerPanel}>
          <header className={styles.drawerHeader}>
            <div><strong>Order entry</strong><span>{dirty ? "Unsaved manual order" : "Manual order"}</span></div>
            <button ref={closeButtonRef} type="button" aria-label="Close order entry" onClick={close}>×</button>
          </header>
          <div className={`${styles.orderEntryDrawerContent} ${styles.formsEditor}`} onChangeCapture={() => setDirty(true)}>
            <ProductionJobForm
              assignees={data.assignees}
              canManageFinance={data.canManageFinance}
              endpoint="/api/forms/jobs"
              detailBasePath="/order-system/jobs"
              backHref="/order-system"
              submittedBy={data.submittedBy}
              productTitles={data.productTitles}
              customFields={data.customFields}
              invoiceBusiness={data.invoiceBusiness}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
