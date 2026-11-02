import { getActiveCartStorageKey } from "./browser-cart-scope";

function key() { return `${getActiveCartStorageKey()}:voucher`; }

export function readActiveVoucherCode(): string {
  if (typeof window === "undefined") return "";
  try { return window.sessionStorage.getItem(key()) ?? ""; } catch { return ""; }
}

export function writeActiveVoucherCode(code: string): void {
  window.sessionStorage.setItem(key(), code);
}

export function clearActiveVoucherCode(): void {
  window.sessionStorage.removeItem(key());
}
