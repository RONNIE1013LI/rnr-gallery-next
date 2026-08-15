import { getActiveCartStorageKey } from "./browser-cart-scope";

export const EMPTY_CART_JSON = '{"version":1,"items":[]}';
const listeners = new Set<() => void>();

export function getCartSnapshot(): string {
  return window.localStorage.getItem(getActiveCartStorageKey()) ?? EMPTY_CART_JSON;
}

export function subscribeToCart(listener: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === getActiveCartStorageKey()) listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

export function notifyCartChanged(): void {
  listeners.forEach((listener) => listener());
}
