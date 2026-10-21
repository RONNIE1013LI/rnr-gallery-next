import type { AnalyticsEvent } from './events';

export const TIKTOK_EVENT = 'rnr:tiktok:commerce';
export function tiktokConfig(id: string | undefined, enabled: string | undefined): string | null {
  return enabled === 'true' && /^[A-Z0-9]{20}$/.test(id ?? '') ? id! : null;
}
export function tiktokRoute(path: string): string | null {
  const normalized = path.replace(/^\/au(?=\/|$)/, '') || '/';
  return /^(?:\/|\/(?:shop|canvas|banners|cart|checkout)|\/products\/[a-z0-9-]+(?:\/configure)?)$/.test(normalized) ? normalized : null;
}
export function tiktokCommerce(event: AnalyticsEvent) {
  const name = event.event === 'view_item' ? 'ViewContent' : event.event === 'add_to_cart' ? 'AddToCart' : event.event === 'begin_checkout' ? 'InitiateCheckout' : null;
  if (!name || !('currency' in event) || !['NZD', 'AUD'].includes(event.currency)
    || !Number.isFinite(event.value) || event.value < 0 || event.items.length > 100) return null;
  const contents = event.items.map(item => ({ content_id: item.item_id, price: item.price, quantity: item.quantity }));
  if (contents.some(item => !/^[a-zA-Z0-9_-]{1,100}$/.test(item.content_id) || !Number.isFinite(item.price) || item.price < 0 || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000)) return null;
  return { name, properties: { currency: event.currency, value: event.value, contents, content_type: 'product' } };
}
type Context = NonNullable<ReturnType<typeof tiktokCommerce>>;
let currentContext: { path: string; at: number; event: Context } | null = null;
export function clearTikTokContext() { currentContext = null; }
export function currentTikTokContext(path: string) {
  if (!currentContext || currentContext.path !== path || Date.now() - currentContext.at > 30 * 60_000) {
    currentContext = null;
    return null;
  }
  return currentContext.event;
}
const emitted = new WeakSet<object>();
export function emitTikTokAnalyticsEvent(event: AnalyticsEvent) {
  if (typeof window === 'undefined') return;
  const safe = tiktokCommerce(event);
  if (!safe) return;
  const path = window.location.pathname;
  if (currentContext?.path !== path) currentContext = null;
  if (tiktokRoute(path) && (safe.name === 'ViewContent' || (safe.name === 'InitiateCheckout' && tiktokRoute(path) === '/checkout'))) {
    currentContext = { path, at: Date.now(), event: safe };
  }
  if (emitted.has(event)) return;
  emitted.add(event);
  window.dispatchEvent(new CustomEvent(TIKTOK_EVENT, { detail: safe }));
}
