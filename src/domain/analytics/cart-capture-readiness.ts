/** In-memory coordination only; contains no visitor or session identity. */
let location: string | null = null;
const listeners = new Set<() => void>();
export function cartAnalyticsReadyAt(pathname: string) { return location === pathname; }
export function completeCartAnalyticsPageview(pathname: string) {
  location = pathname;
  listeners.forEach((listener) => listener());
}
export function subscribeCartAnalyticsReady(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
