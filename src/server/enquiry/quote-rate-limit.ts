import { createHash, createHmac } from "node:crypto";
import { Redis } from "@upstash/redis";
import { hashTrustedNetworkBucket, resolveTrustedClientIp } from "@/server/customer-service/website/rate-limit";

// Only opaque abuse counters and retry identifiers are kept, never enquiry content.
const consume = `
local attempts = tonumber(redis.call("GET", KEYS[3]) or "0")
if attempts >= 15 then return 0 end
redis.call("INCR", KEYS[3])
if attempts == 0 then redis.call("EXPIRE", KEYS[3], 3700) end
if redis.call("EXISTS", KEYS[2]) == 1 then return 1 end
local count = tonumber(redis.call("GET", KEYS[1]) or "0")
if count >= 5 then return 0 end
redis.call("INCR", KEYS[1])
redis.call("EXPIRE", KEYS[1], 3700)
redis.call("SET", KEYS[2], "1", "EX", 3700)
return 1
`;

type RateRedis = { eval(script: string, keys: string[], args: string[]): Promise<unknown> };
export function createQuoteRateLimit(input: {
  redis: RateRedis; namespace: string; secret: string;
  resolveIp?: (request: Request) => string; now?: () => Date;
}) {
  if (!/^[a-z0-9][a-z0-9:_-]{2,80}$/i.test(input.namespace) || input.secret.length < 32) throw new Error("quote_rate_limit_unavailable");
  return async (request: Request, requestId: string) => {
    const now = input.now?.() ?? new Date();
    const network = hashTrustedNetworkBucket({ ip: (input.resolveIp ?? resolveTrustedClientIp)(request), secret: input.secret, now });
    const key = `${input.namespace}:quote-rate:${network}:${Math.floor(now.getTime() / 3_600_000)}`;
    const retry = `${key}:${createHash("sha256").update(requestId).digest("hex")}`;
    return await input.redis.eval(consume, [key, retry, `${key}:attempts`], []) === 1;
  };
}

export function productionQuoteRateLimit(env: Record<string, string | undefined> = process.env) {
  const url = env.RNR_AI_REDIS_REST_URL?.trim();
  const token = env.RNR_AI_REDIS_REST_TOKEN?.trim();
  const namespace = env.RNR_AI_REDIS_NAMESPACE?.trim();
  const authSecret = env.BETTER_AUTH_SECRET?.trim();
  const secret = env.CUSTOMER_CHAT_ABUSE_HASH_SECRET?.trim() || (authSecret && authSecret.length >= 32
    ? createHmac("sha256", authSecret).update("rnr-quote-rate-limit-v1").digest("hex")
    : undefined);
  if (!url || !token || !namespace || !secret) throw new Error("quote_rate_limit_unavailable");
  return createQuoteRateLimit({ redis: new Redis({ url, token }), namespace, secret });
}
