"use client";

import { useRef } from "react";

type Props = Readonly<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  direction: 1 | -1;
  onChange: (value: number) => void;
  className?: string;
}>;

export function ResizableSeparator({
  label,
  value,
  min,
  max,
  step = 20,
  direction,
  onChange,
  className,
}: Props) {
  const dragStart = useRef<{ x: number; value: number } | null>(null);

  function clamp(next: number) {
    return Math.min(max, Math.max(min, next));
  }

  function stopDragging() {
    dragStart.current = null;
  }

  return (
    <div
      className={className}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={(event) => {
        dragStart.current = { x: event.clientX, value };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!dragStart.current) return;
        onChange(clamp(dragStart.current.value + ((event.clientX - dragStart.current.x) * direction)));
      }}
      onPointerUp={(event) => {
        stopDragging();
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }}
      onPointerCancel={stopDragging}
      onLostPointerCapture={stopDragging}
      onKeyDown={(event) => {
        let next: number | null = null;
        if (event.key === "ArrowLeft") next = value - (step * direction);
        if (event.key === "ArrowRight") next = value + (step * direction);
        if (event.key === "Home") next = min;
        if (event.key === "End") next = max;
        if (next === null) return;
        event.preventDefault();
        onChange(clamp(next));
      }}
    />
  );
}
