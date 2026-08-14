"use client";

import { useEffect, useRef, type RefObject } from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableElements(dialog: HTMLElement) {
  return [...dialog.querySelectorAll<HTMLElement>(focusableSelector)]
    .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

function isolateBackground(root: HTMLElement, allowed: readonly HTMLElement[]) {
  const restore: (() => void)[] = [];
  let branch: HTMLElement | null = root;

  while (branch?.parentElement) {
    const parent: HTMLElement = branch.parentElement;
    for (const sibling of parent.children) {
      if (!(sibling instanceof HTMLElement) || sibling === branch) continue;
      if (allowed.some((element) => sibling === element || sibling.contains(element))) continue;

      const wasInert = sibling.inert;
      const previousAriaHidden = sibling.getAttribute("aria-hidden");
      sibling.inert = true;
      sibling.setAttribute("aria-hidden", "true");
      restore.push(() => {
        sibling.inert = wasInert;
        if (previousAriaHidden === null) sibling.removeAttribute("aria-hidden");
        else sibling.setAttribute("aria-hidden", previousAriaHidden);
      });
    }
    branch = parent;
    if (parent === document.body) break;
  }

  return () => {
    for (const restoreElement of restore.reverse()) restoreElement();
  };
}

export function useContainedDialog({
  active,
  dialogRef,
  initialFocusRef,
  isolationRootRef,
  additionalActiveRef,
  returnFocusRef,
  onClose,
}: Readonly<{
  active: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  isolationRootRef?: RefObject<HTMLElement | null>;
  additionalActiveRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
}>) {
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!active) return;
    const dialog = dialogRef.current;
    const isolationRoot = isolationRootRef?.current ?? dialog;
    if (!dialog || !isolationRoot) return;

    const previousFocus = returnFocusRef?.current ?? (
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    );
    const additionalActive = additionalActiveRef?.current;
    const restoreBackground = isolateBackground(
      isolationRoot,
      additionalActive ? [additionalActive] : [],
    );
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = document.documentElement.clientWidth > 0
      ? window.innerWidth - document.documentElement.clientWidth
      : 0;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

    const focusTarget = initialFocusRef?.current ?? focusableElements(dialog)[0] ?? dialog;
    focusTarget.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = focusableElements(dialog!);
      if (!focusable.length) {
        event.preventDefault();
        dialog!.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !dialog!.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !dialog!.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    function handleFocusIn(event: FocusEvent) {
      if (event.target instanceof Node && !dialog!.contains(event.target)) {
        (initialFocusRef?.current ?? focusableElements(dialog!)[0] ?? dialog!).focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", handleFocusIn, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      restoreBackground();
      previousFocus?.focus();
    };
  }, [active, additionalActiveRef, dialogRef, initialFocusRef, isolationRootRef, returnFocusRef]);
}
