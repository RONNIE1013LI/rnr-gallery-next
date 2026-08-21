"use client";

import { useState } from "react";

function parseMoney(value: string) {
  if (!value || value === ".") return null;
  const cents = Math.round(Number(value) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= 100_000_000 ? cents : null;
}

export function MoneyCentsInput({
  ariaLabel,
  cents,
  disabled = false,
  name,
  onCentsChange,
  required = false,
}: Readonly<{
  ariaLabel: string;
  cents: number;
  disabled?: boolean;
  name?: string;
  onCentsChange: (cents: number) => void;
  required?: boolean;
}>) {
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const displayValue = editingValue ?? (cents / 100).toFixed(2);

  return <input
    aria-label={ariaLabel}
    disabled={disabled}
    inputMode="decimal"
    name={name}
    pattern="[0-9]+(?:\.[0-9]{0,2})?"
    required={required}
    type="text"
    value={displayValue}
    onChange={(event) => {
      const value = event.target.value;
      if (!/^\d*(?:\.\d{0,2})?$/.test(value)) return;
      setEditingValue(value);
      const next = parseMoney(value);
      if (next !== null) onCentsChange(next);
    }}
    onBlur={() => {
      const next = parseMoney(displayValue) ?? 0;
      setEditingValue(null);
      onCentsChange(next);
    }}
  />;
}
