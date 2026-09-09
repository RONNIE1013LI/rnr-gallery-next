import { z } from "zod";
import { parseAttribution } from "./attribution";
import { classifyWebsiteAttribution } from "./website-attribution";
import { isTrackableWebsitePath } from "./website-path-policy";

const MAX_AGE = 90 * 86_400_000;
const SESSION_GAP = 30 * 60_000;
const OWN_HOSTS = new Set(["rnrgallery.com", "www.rnrgallery.com", "rrgallery.co.nz", "www.rrgallery.co.nz"]);
const campaignSchema = z.record(z.string(), z.string().min(1).max(200)).refine(value =>
  Object.keys(parseAttribution(new URLSearchParams(value)) ?? {}).length === Object.keys(value).length);
const touchSchema = z.object({
  at: z.iso.datetime(),
  landingPath: z.string().max(512).refine(path => isTrackableWebsitePath(path) && !/[?#]/.test(path)),
  referrerOrigin: z.string().max(255).nullable().refine(value => {
    if (value === null) return true;
    try { const url = new URL(value); return /^https?:$/.test(url.protocol) && url.origin === value; } catch { return false; }
  }),
  campaign: campaignSchema,
}).strict();
export const attributionHistorySchema = z.object({
  version: z.literal(1),
  firstTouch: touchSchema,
  lastTouch: touchSchema,
  lastNonDirectTouch: touchSchema.nullable(),
  lastSeenAt: z.iso.datetime(),
}).strict();
export type AttributionTouch = z.infer<typeof touchSchema>;
export type AttributionHistory = z.infer<typeof attributionHistorySchema>;
type StorageReader = Pick<Storage, "getItem">;
type HistoryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function attributionHistoryKey(customerId: string | null) {
  return `rnr:analytics:v1:${customerId === null ? "guest" : `user:${encodeURIComponent(customerId)}`}:touches`;
}
export function clearAttributionHistory(storage: Pick<Storage, "removeItem">, customerId: string | null) {
  try { storage.removeItem(attributionHistoryKey(customerId)); } catch { /* Storage can be disabled. */ }
}
export function readAttributionHistory(storage: StorageReader, customerId: string | null, now = new Date()): AttributionHistory | null {
  try {
    const parsed = attributionHistorySchema.safeParse(JSON.parse(storage.getItem(attributionHistoryKey(customerId)) ?? "null"));
    if (!parsed.success) return null;
    const h = parsed.data;
    const times = [h.firstTouch.at, h.lastTouch.at, h.lastSeenAt, ...(h.lastNonDirectTouch ? [h.lastNonDirectTouch.at] : [])].map(Date.parse);
    if (times.some(t => t > now.getTime()) || now.getTime() - Date.parse(h.lastSeenAt) > MAX_AGE
      || Date.parse(h.firstTouch.at) > Date.parse(h.lastTouch.at) || Date.parse(h.lastTouch.at) > Date.parse(h.lastSeenAt)
      || (h.lastNonDirectTouch && Date.parse(h.lastNonDirectTouch.at) > Date.parse(h.lastTouch.at))) return null;
    const valid = (touch: AttributionTouch) => now.getTime() - Date.parse(touch.at) <= MAX_AGE;
    const remaining = [h.firstTouch, h.lastNonDirectTouch, h.lastTouch].filter((t): t is AttributionTouch => Boolean(t && valid(t)))
      .sort((a,b) => Date.parse(a.at) - Date.parse(b.at));
    if (!remaining.length) return null;
    return { ...h, firstTouch: remaining[0], lastNonDirectTouch: h.lastNonDirectTouch && valid(h.lastNonDirectTouch) ? h.lastNonDirectTouch : null };
  } catch { return null; }
}
export function classifyAttributionTouch(touch: AttributionTouch) {
  const c = touch.campaign;
  return classifyWebsiteAttribution({ advertisingConsent: true, utmSource: c.utm_source ?? null, utmMedium: c.utm_medium ?? null,
    utmCampaign: c.utm_campaign ?? null, referrerOrigin: touch.referrerOrigin,
    clickIdTypes: ["gclid", "gbraid", "wbraid", "fbclid"].filter(k => Boolean(c[k])),
  });
}
export function acquisitionAttribution(history: AttributionHistory) {
  return classifyAttributionTouch(history.lastNonDirectTouch ?? history.firstTouch);
}
export function consentedAttributionHistory(history: AttributionHistory, advertising: boolean): AttributionHistory {
  if (advertising) return history;
  const strip = (touch: AttributionTouch): AttributionTouch => {
    const campaign = Object.fromEntries(Object.entries(touch.campaign).filter(([key]) => !["fbclid", "gclid", "gbraid", "wbraid"].includes(key)));
    return { ...touch, campaign };
  };
  const firstTouch = strip(history.firstTouch);
  const lastTouch = strip(history.lastTouch);
  const lastNonDirectTouch = [firstTouch, lastTouch, ...(history.lastNonDirectTouch ? [strip(history.lastNonDirectTouch)] : [])]
    .filter(touch => classifyAttributionTouch(touch).channel !== "direct")
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
  return { ...history, firstTouch, lastTouch, lastNonDirectTouch };
}
export function captureAttributionHistory(storage: HistoryStorage, customerId: string | null, input: Readonly<{
  url: string; referrer: string; now: Date; consent: Readonly<{ analytics: boolean; advertising: boolean }>;
}>): AttributionHistory | null {
  if (!input.consent.analytics) { clearAttributionHistory(storage, customerId); return null; }
  try {
    const url = new URL(input.url);
    if (!isTrackableWebsitePath(url.pathname)) {
      const saved = readAttributionHistory(storage, customerId, input.now);
      if (!saved) return null;
      const filtered = consentedAttributionHistory(saved, input.consent.advertising);
      storage.setItem(attributionHistoryKey(customerId), JSON.stringify(filtered));
      return filtered;
    }
    let referrerOrigin: string | null = null;
    let ownReferrer = false;
    try {
      const referrer = new URL(input.referrer);
      ownReferrer = referrer.origin === url.origin || OWN_HOSTS.has(referrer.hostname);
      if (!ownReferrer && /^https?:$/.test(referrer.protocol)) referrerOrigin = referrer.origin.slice(0,255);
    } catch { /* Empty referrer is a Direct entry. */ }
    const campaign = { ...parseAttribution(url.searchParams) };
    if (!input.consent.advertising) {
      for (const key of ["fbclid", "gclid", "gbraid", "wbraid"] as const) delete campaign[key];
    }
    const touch = { at: input.now.toISOString(), landingPath: url.pathname, referrerOrigin, campaign };
    const saved = readAttributionHistory(storage, customerId, input.now);
    const previous = saved ? consentedAttributionHistory(saved, input.consent.advertising) : null;
    const tagged = Object.keys(campaign).length > 0;
    const withinSession = previous && input.now.getTime() - Date.parse(previous.lastSeenAt) < SESSION_GAP;
    const sameTaggedEntry = previous && tagged && previous.lastTouch.landingPath === touch.landingPath
      && JSON.stringify(previous.lastTouch.campaign) === JSON.stringify(campaign) && withinSession;
    const next = previous && ((!tagged && ownReferrer && withinSession) || sameTaggedEntry)
      ? { ...previous, lastSeenAt: input.now.toISOString() }
      : { version: 1 as const, firstTouch: previous?.firstTouch ?? touch, lastTouch: touch,
        lastNonDirectTouch: classifyAttributionTouch(touch).channel !== "direct" ? touch : previous?.lastNonDirectTouch ?? null,
        lastSeenAt: input.now.toISOString() };
    const filtered = consentedAttributionHistory(next, input.consent.advertising);
    storage.setItem(attributionHistoryKey(customerId), JSON.stringify(filtered));
    return filtered;
  } catch { return null; }
}
export function handoffAttributionHistory(storage: HistoryStorage, customerId: string, now = new Date()) {
  const guest = readAttributionHistory(storage, null, now);
  const existing = readAttributionHistory(storage, customerId, now);
  if (guest) {
    const latest = existing && Date.parse(existing.lastTouch.at) > Date.parse(guest.lastTouch.at) ? existing : guest;
    const nonDirect = [existing?.lastNonDirectTouch, guest.lastNonDirectTouch].filter((x): x is AttributionTouch => Boolean(x))
      .sort((a,b) => Date.parse(b.at)-Date.parse(a.at))[0] ?? null;
    const merged = { ...latest, firstTouch: existing && Date.parse(existing.firstTouch.at) < Date.parse(guest.firstTouch.at) ? existing.firstTouch : guest.firstTouch, lastNonDirectTouch: nonDirect };
    try { storage.setItem(attributionHistoryKey(customerId), JSON.stringify(merged)); } catch { return; }
  }
  clearAttributionHistory(storage, null);
}
