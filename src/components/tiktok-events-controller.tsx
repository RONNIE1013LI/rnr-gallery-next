"use client";

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useAdvertisingConsent, useExplicitAdvertisingConsent } from './consent-preferences';
import { TIKTOK_EVENT, tiktokRoute, currentTikTokContext, clearTikTokContext, type tiktokCommerce } from '@/domain/analytics/tiktok';
import { getActiveCustomerId } from '@/domain/cart/browser-cart-scope';
import { parseAttribution, readAttribution } from '@/domain/analytics/attribution';

type Message = NonNullable<ReturnType<typeof tiktokCommerce>> | { name: 'PageView'; properties: Record<string, never> };
const LEDGER_KEY = 'rnr:tiktok:v2:events';
type Entry = { at: number; eventId: string; accepted: boolean };
function readLedger(): Record<string, Entry> {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(LEDGER_KEY) ?? '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).filter(([, e]) => e && typeof e === 'object'
      && typeof e.at === 'number' && Date.now() - e.at >= 0 && Date.now() - e.at < 30 * 60_000
      && typeof e.eventId === 'string' && /^[0-9a-f-]{36}$/i.test(e.eventId) && typeof e.accepted === 'boolean').slice(-100));
  } catch { return {}; }
}
function writeLedger(key: string, entry: Entry) {
  try {
    const entries = Object.entries(readLedger()).filter(([saved]) => saved !== key).slice(-99);
    sessionStorage.setItem(LEDGER_KEY, JSON.stringify({ ...Object.fromEntries(entries), [key]: entry }));
  } catch { /* Storage may be unavailable. */ }
}

export function TikTokEventsController({ production, enabled }: Readonly<{ production: boolean; enabled: boolean }>) {
  const consent = useAdvertisingConsent();
  const explicit = useExplicitAdvertisingConsent();
  const pathname = usePathname() || '/';
  const route = tiktokRoute(pathname);
  const allowed = production && enabled && !!route && consent?.advertising === true && explicit === true;

  const wasAllowed = useRef(false);
  useEffect(() => {
    if (!allowed) {
      if (wasAllowed.current) clearTikTokContext();
      wasAllowed.current = false;
      return;
    }
    wasAllowed.current = true;
    const controller = new AbortController();
    const pending = new Set<string>();
    async function send(message: Message) {
      if (controller.signal.aborted || pending.size >= 50) return;
      const key = JSON.stringify([pathname, message.name, message.properties]);
      const ledger = readLedger();
      const repeatable = message.name === 'AddToCart';
      const now = Date.now();
      if (!repeatable && (pending.has(key) || ledger[key]?.accepted)) return;
      const eventId = (!repeatable && ledger[key]?.eventId) || crypto.randomUUID();
      if (!repeatable) writeLedger(key, { at: ledger[key]?.at ?? now, eventId, accepted: false });
      const pendingKey = repeatable ? eventId : key;
      pending.add(pendingKey);
      try {
        const ttclid = parseAttribution(new URLSearchParams(window.location.search))?.ttclid
          ?? readAttribution(sessionStorage, getActiveCustomerId())?.ttclid;
        const response = await fetch('/api/analytics/tiktok', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...message, eventId, pathname, ...(ttclid ? { ttclid } : {}) }),
          signal: controller.signal, keepalive: true,
        });
        if (response.status !== 200 || !(await response.json()).accepted || controller.signal.aborted || repeatable) return;
        writeLedger(key, { at: now, eventId, accepted: true });
      } catch { /* Measurement must never block a customer action. */ }
      finally { pending.delete(pendingKey); }
    }
    // Strict Mode's first setup is cancelled before any network work starts.
    queueMicrotask(() => {
      void send({ name: 'PageView', properties: {} });
      if (!controller.signal.aborted) {
        const context = currentTikTokContext(pathname);
        if (context) void send(context);
      }
    });
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<Message>).detail;
      if (!detail || !['ViewContent', 'AddToCart', 'InitiateCheckout'].includes(detail.name)) return;
      if (detail.name === 'InitiateCheckout' && route !== '/checkout') return;
      void send(detail);
    };
    window.addEventListener(TIKTOK_EVENT, handle);
    return () => { controller.abort(); window.removeEventListener(TIKTOK_EVENT, handle); };
  }, [allowed, pathname, route]);
  return null;
}
