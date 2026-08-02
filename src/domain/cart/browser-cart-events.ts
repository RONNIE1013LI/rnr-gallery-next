import { CART_STORAGE_KEY } from "./types";

export const EMPTY_CART_JSON = '{"version":1,"items":[]}';
const listeners = new Set<() => void>();

export function getCartSnapshot(): string {
  return window.localStorage.getItem(CART_STORAGE_KEY) ?? EMPTY_CART_JSON;
}

export function subscribeToCart(listener: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === CART_STORAGE_KEY) listener();
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
