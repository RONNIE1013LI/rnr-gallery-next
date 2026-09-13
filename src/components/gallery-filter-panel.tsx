"use client";

import { useRef, useState, type ReactNode } from "react";
import { useContainedDialog } from "./forms/use-contained-dialog";
import css from "./gallery-filter-panel.module.css";

export function GalleryFilterPanel({ children, count, initiallyOpen = false }: { children: ReactNode; count: number; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useContainedDialog({ active: open, dialogRef: dialog, returnFocusRef: trigger, onClose: () => setOpen(false) });
  return <div id="browse-by-occasion" className={css.root}>
    <button ref={trigger} className={css.trigger} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>Filters ({count})</button>
    {open ? <div className={css.overlay} onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div ref={dialog} className={css.panel} role="dialog" aria-modal="true" aria-label="Filter designs" tabIndex={-1}>
        <header><h2>Filter designs</h2><button type="button" aria-label="Close filters" onClick={() => setOpen(false)}>Close</button></header>
        {children}
      </div>
    </div> : null}
  </div>;
}
