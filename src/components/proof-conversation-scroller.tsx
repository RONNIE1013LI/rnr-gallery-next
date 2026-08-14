"use client";

import Image from "next/image";
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

type ProofConversationScrollerProps = Readonly<{
  className?: string;
}>;

const AUTO_SCROLL_SPEED = 22;
const EDGE_PAUSE_MS = 1_400;
const MANUAL_RESUME_DELAY_MS = 2_500;

export function ProofConversationScroller({
  className,
}: ProofConversationScrollerProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const pointerPressedRef = useRef(false);
  const resumeAtRef = useRef(0);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const prefersReducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let direction = 1;
    let holdUntil = performance.now() + EDGE_PAUSE_MS;
    let previousTime = performance.now();

    const animate = () => {
      const currentTime = performance.now();
      const elapsed = Math.min(currentTime - previousTime, 1_000);
      previousTime = currentTime;

      const maximumScroll = Math.max(0, frame.scrollHeight - frame.clientHeight);
      const canAutoScroll =
        !prefersReducedMotion &&
        !pointerPressedRef.current &&
        !frame.matches(":hover") &&
        document.activeElement !== frame &&
        currentTime >= resumeAtRef.current &&
        currentTime >= holdUntil &&
        maximumScroll > 1;

      if (canAutoScroll) {
        frame.scrollTop += (direction * AUTO_SCROLL_SPEED * elapsed) / 1_000;

        if (direction > 0 && frame.scrollTop >= maximumScroll - 1) {
          frame.scrollTop = maximumScroll;
          direction = -1;
          holdUntil = currentTime + EDGE_PAUSE_MS;
        } else if (direction < 0 && frame.scrollTop <= 1) {
          frame.scrollTop = 0;
          direction = 1;
          holdUntil = currentTime + EDGE_PAUSE_MS;
        }
      }
    };

    const interval = window.setInterval(animate, 50);
    return () => window.clearInterval(interval);
  }, []);

  const pauseForManualControl = () => {
    resumeAtRef.current = performance.now() + MANUAL_RESUME_DELAY_MS;
  };

  const releasePointerPause = () => {
    pointerPressedRef.current = false;
    pauseForManualControl();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const frame = frameRef.current;
    if (!frame) return;

    const keyScrollTargets: Partial<Record<string, number>> = {
      ArrowDown: frame.scrollTop + 40,
      ArrowUp: frame.scrollTop - 40,
      End: frame.scrollHeight,
      Home: 0,
      PageDown: frame.scrollTop + frame.clientHeight * 0.8,
      PageUp: frame.scrollTop - frame.clientHeight * 0.8,
    };
    const target = keyScrollTargets[event.key];
    if (target === undefined) return;

    event.preventDefault();
    frame.scrollTop = target;
    pauseForManualControl();
  };

  return (
    <div
      ref={frameRef}
      className={className}
      role="region"
      aria-label="Customer design proof and approval conversation"
      tabIndex={0}
      data-proof-scroll="auto-manual"
      onPointerDown={() => {
        pointerPressedRef.current = true;
      }}
      onPointerUp={releasePointerPause}
      onPointerCancel={releasePointerPause}
      onWheel={pauseForManualControl}
      onKeyDown={handleKeyDown}
      onBlur={releasePointerPause}
    >
      <Image
        src="/media/home/design-proof-customer-confirmation.jpg"
        width={493}
        height={804}
        sizes="(max-width: 760px) calc(100vw - 6.5rem), 340px"
        alt="Memorial artwork proof followed by the customer's approval to print"
      />
    </div>
  );
}
