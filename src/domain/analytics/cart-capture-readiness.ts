/** In-memory coordination only; contains no visitor or session identity. */
let location: string | null = null;
let completedAt = 0;
const listeners = new Set<() => void>();
export function cartAnalyticsReadyAt(pathname: string) { return location === pathname && Date.now() - completedAt < 25 * 60_000; }
export function completeCartAnalyticsPageview(pathname: string) {
  location = pathname;
  completedAt = Date.now();
  listeners.forEach((listener) => listener());
}
export function subscribeCartAnalyticsReady(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
