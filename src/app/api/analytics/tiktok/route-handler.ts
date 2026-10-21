import { createHmac } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { z } from 'zod';
import { tiktokConfig, tiktokRoute } from '@/domain/analytics/tiktok';
import { ADVERTISING_CONSENT_COOKIE, TIKTOK_CONSENT_COOKIE, parseAdvertisingConsent } from '@/domain/consent/advertising-consent';
import { assertTrustedMutationRequest, parseBoundedJson } from '@/server/http/mutation-request';
import { resolveTrustedClientIp } from '@/server/customer-service/website/rate-limit';

const commerce = z.strictObject({
  currency: z.enum(['NZD', 'AUD']), value: z.number().finite().nonnegative(), content_type: z.literal('product'),
  contents: z.array(z.strictObject({ content_id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    price: z.number().finite().nonnegative(), quantity: z.number().int().min(1).max(1000) })).max(100),
});
const base = { eventId: z.uuid(), pathname: z.string().max(256).refine(path => !!tiktokRoute(path)),
  ttclid: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).optional() };
const payloadSchema = z.discriminatedUnion('name', [
  z.strictObject({ ...base, name: z.literal('PageView'), properties: z.strictObject({}) }),
  ...(['ViewContent', 'AddToCart', 'InitiateCheckout'] as const).map(name => z.strictObject({ ...base, name: z.literal(name), properties: commerce })),
]);
type Config = Readonly<{ enabled: boolean; pixelId?: string; token?: string; testCode?: string }>;
type Dependencies = Readonly<{ config?: Config; trustedOrigin?: string; now?: () => Date;
  send?: typeof fetch; claim?: (request: Request, eventId: string) => Promise<boolean>;
  finish?: (eventId: string, accepted: boolean) => Promise<void> }>;

function cookie(request: Request, name: string) {
  return request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(name+'='))?.slice(name.length+1);
}
function empty() { return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } }); }
function configuration(): Config {
  return { enabled: process.env.VERCEL_ENV === 'production' && process.env.TIKTOK_PIXEL_ENABLED === 'true',
    pixelId: process.env.TIKTOK_PIXEL_ID, token: process.env.TIKTOK_EVENTS_API_TOKEN };
}

// Atomic cross-instance limits and a bounded event-id lease. Fail closed if Redis
// or trusted network identity is unavailable. Never persist client IPs or payloads.
const CLAIM_SCRIPT = `
local network = redis.call('INCR', KEYS[1])
if network == 1 then redis.call('EXPIRE', KEYS[1], 60) end
if network > 30 then return 0 end
local total = redis.call('INCR', KEYS[2])
if total == 1 then redis.call('EXPIRE', KEYS[2], 60) end
if total > 120 then return 0 end
if not redis.call('SET', KEYS[3], '1', 'NX', 'EX', 60) then return 0 end
return 1`;
function runtimeClaim(config: Config) {
  let redis: Redis | undefined;
  const namespace = process.env.RNR_AI_REDIS_NAMESPACE;
  const prefix = `${namespace}:tiktok:${config.pixelId}`;
  return {
    claim: async (request: Request, eventId: string) => {
      const url = process.env.RNR_AI_REDIS_REST_URL;
      const token = process.env.RNR_AI_REDIS_REST_TOKEN;
      if (!url || !token || !namespace || !config.token) return false;
      const ip = resolveTrustedClientIp(request);
      const digest = createHmac('sha256', config.token).update(ip).digest('hex');
      redis ??= new Redis({ url, token });
      return await redis.eval(CLAIM_SCRIPT, [`${prefix}:network:${digest}`, `${prefix}:total`, `${prefix}:event:${eventId}`], []) === 1;
    },
    finish: async (eventId: string, accepted: boolean) => {
      if (!redis) return;
      if (accepted) await redis.set(`${prefix}:event:${eventId}`, '1', { ex: 172800 });
      else await redis.del(`${prefix}:event:${eventId}`);
    },
  };
}

export function createTikTokEventsRoute(dependencies: Dependencies = {}) {
  let lease: ReturnType<typeof runtimeClaim>;
  return async function POST(request: Request) {
    try {
      const config = dependencies.config ?? configuration();
      if (!tiktokConfig(config.pixelId, config.enabled ? 'true' : 'false') || !config.token) return empty();
      assertTrustedMutationRequest(request, dependencies.trustedOrigin);
      const consent = parseAdvertisingConsent(cookie(request, ADVERTISING_CONSENT_COOKIE));
      if (!consent?.advertising || decodeURIComponent(cookie(request, TIKTOK_CONSENT_COOKIE) ?? '') !== consent.decidedAt) return empty();
      const parsed = payloadSchema.safeParse(await parseBoundedJson(request, 16_384));
      if (!parsed.success) return empty();
      const event = parsed.data;
      if (event.name === 'InitiateCheckout' && tiktokRoute(event.pathname) !== '/checkout') return empty();
      if (!dependencies.claim) lease ??= runtimeClaim(config);
      const claim = dependencies.claim ?? lease.claim;
      const finish = dependencies.finish ?? (dependencies.claim ? undefined : lease.finish);
      if (!await claim(request, event.eventId)) return empty();
      const response = await (dependencies.send ?? fetch)('https://business-api.tiktok.com/open_api/v1.3/event/track/', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Access-Token': config.token },
        signal: AbortSignal.timeout(5000), redirect: 'error', cache: 'no-store',
        body: JSON.stringify({ event_source: 'web', event_source_id: config.pixelId,
          ...(config.testCode ? { test_event_code: config.testCode } : {}),
          data: [{ event: event.name === 'PageView' ? 'Pageview' : event.name, event_id: event.eventId,
            event_time: Math.floor((dependencies.now?.() ?? new Date()).getTime()/1000),
            page: { url: `https://rnrgallery.com${event.pathname}` },
            user: event.ttclid ? { ttclid: event.ttclid } : {}, properties: event.properties }],
        }),
      });
      if (!response.ok) { await finish?.(event.eventId, false); return empty(); }
      const accepted = (await response.json()).code === 0;
      await finish?.(event.eventId, accepted);
      if (!accepted) return empty();
      return Response.json({ accepted: true }, { headers: { 'Cache-Control': 'no-store' } });
    } catch { return empty(); }
  };
}
export const POST = createTikTokEventsRoute();
