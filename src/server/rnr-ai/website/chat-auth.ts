import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Redis } from "@upstash/redis";
import { getCookies } from "better-auth/cookies";
import { getBetterAuthBaseURL, parseAuthConfig } from "@/server/auth/config";

// This module deliberately never imports auth.ts or a database adapter. Activation
// of authOptions in global Better Auth requires separate owner approval.
type RedisClient = {
  get(key: string): Promise<unknown>;
  set(key: string, value: string, options?: { ex: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
};
type CandidateOptions = {
  redis: RedisClient;
  namespace: string;
  encryptionKey: string;
  secret: string;
  baseURL: Parameters<typeof getCookies>[0]["baseURL"];
  now?: () => number;
};

export class WebsiteChatIdentityUnavailableError extends Error {
  readonly code = "WEBSITE_CHAT_IDENTITY_UNAVAILABLE";
  constructor() { super("Your signed-in chat session is unavailable. Please sign in again or retry shortly."); }
}

export function createWebsiteChatAuthCandidate(options: CandidateOptions) {
  if (!/^[a-z0-9][a-z0-9:_-]{2,80}$/i.test(options.namespace) || options.encryptionKey.length < 32 || options.secret.length < 32) {
    throw new Error("Website chat authentication configuration is unavailable");
  }
  const now = options.now ?? Date.now;
  const derive = (label: string) => createHmac("sha256", options.encryptionKey).update(`rnr:website-chat-auth:v1:${label}`).digest();
  const encryptionKey = derive("encryption");
  const hashKey = derive("key-hash");
  const redisKey = (key: string) => `${options.namespace}:website-chat-auth:v1:${createHmac("sha256", hashKey).update(key).digest("hex")}`;
  const userWatermarkKey = (userId: string) => redisKey(`user-revocation-${userId}`);
  async function revokeUser(userId: string) {
    // Native bulk revocation can miss per-row hooks (100-row enumeration limit
    // or a swallowed enumeration failure). Fence every previously issued token.
    await options.redis.eval(`
      local previous = tonumber(redis.call('GET', KEYS[2]) or '0')
      local watermark = math.max(previous, tonumber(ARGV[1]))
      redis.call('SET', KEYS[2], tostring(watermark), 'EX', ARGV[2])
      return redis.call('DEL', KEYS[1])
    `, [redisKey(`active-sessions-${userId}`), userWatermarkKey(userId)], [String(now()), String(30 * 86400)]);
  }
  const secondaryStorage = {
    async get(key: string): Promise<string | null> {
      const address = redisKey(key);
      if (await options.redis.get(`${address}:revoked`)) return null;
      const raw = await options.redis.get(address);
      if (raw === null || raw === undefined) return null;
      if (typeof raw !== "string") throw new Error("Invalid encrypted auth cache");
      const packed = Buffer.from(raw, "base64url");
      if (packed.length < 29) throw new Error("Invalid encrypted auth cache");
      const decipher = createDecipheriv("aes-256-gcm", encryptionKey, packed.subarray(0, 12));
      decipher.setAAD(Buffer.from(address));
      decipher.setAuthTag(packed.subarray(12, 28));
      const data = JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8")) as { value: string; expiresAt: number | null };
      if (typeof data.value !== "string" || (data.expiresAt !== null && (!Number.isFinite(data.expiresAt) || data.expiresAt <= now()))) return null;
      const cached = JSON.parse(data.value) as { session?: { createdAt?: string }; user?: { id?: string } };
      if (cached?.session && cached?.user?.id) {
        const revokedAt = await options.redis.get(userWatermarkKey(cached.user.id));
        if (revokedAt !== null && revokedAt !== undefined) {
          const issuedAt = Date.parse(cached.session.createdAt ?? "");
          if (!Number.isFinite(issuedAt) || !Number.isFinite(Number(revokedAt)) || issuedAt <= Number(revokedAt)) return null;
        }
      }
      return data.value;
    },
    async set(key: string, value: string, ttl?: number) {
      if (ttl !== undefined && (!Number.isFinite(ttl) || ttl <= 0)) {
        await options.redis.del(redisKey(key));
        return;
      }
      const address = redisKey(key);
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
      cipher.setAAD(Buffer.from(address));
      const encrypted = Buffer.concat([cipher.update(JSON.stringify({ value, expiresAt: ttl === undefined ? null : now() + ttl * 1000 })), cipher.final()]);
      const packed = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
      // A cache refresh that started before revocation must not resurrect its
      // token. The check and write are one Redis operation, across all workers.
      await options.redis.eval(`
        if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
        if ARGV[2] == '' then redis.call('SET', KEYS[1], ARGV[1])
        else redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2]) end
        return 1
      `, [address, `${address}:revoked`], [packed, ttl === undefined ? "" : String(Math.ceil(ttl))]);
    },
    async delete(key: string) {
      if (key.startsWith("active-sessions-")) await revokeUser(key.slice("active-sessions-".length));
      else await options.redis.del(redisKey(key));
    },
  };
  const cookieName = getCookies({ baseURL: options.baseURL }).sessionToken.name;
  async function getIdentitySession(headers: Headers): Promise<{ user: { id: string } } | null> {
    // Reject ambiguity, including an obsolete HTTP cookie alongside the HTTPS
    // cookie. A present invalid cookie must never become an anonymous session.
    const cookieParts = (headers.get("cookie") ?? "").split(";").map((part) => part.trim());
    const sessionCookies = cookieParts.filter((part) => {
      const name = part.split("=", 1)[0].trim();
      return name === "better-auth.session_token" || name === "__Secure-better-auth.session_token";
    });
    if (sessionCookies.length === 0) return null;
    try {
      if (sessionCookies.length !== 1 || !sessionCookies[0].startsWith(`${cookieName}=`)) throw new Error("Ambiguous session cookie");
      const signed = decodeURIComponent(sessionCookies[0].slice(cookieName.length + 1));
      const dot = signed.lastIndexOf(".");
      if (dot < 1 || signed.length > 4096) throw new Error("Invalid session cookie");
      const token = signed.slice(0, dot);
      const signature = signed.slice(dot + 1);
      if (!/^[A-Za-z0-9+/]{43}=$/.test(signature)) throw new Error("Invalid session signature");
      const actual = Buffer.from(signature, "base64");
      const expected = createHmac("sha256", options.secret).update(token).digest();
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Invalid session signature");
      const raw = await secondaryStorage.get(token);
      if (!raw) throw new Error("Session cache unavailable");
      const cached = JSON.parse(raw) as { session?: { token?: string; userId?: string; expiresAt?: string }; user?: { id?: string } };
      const id = cached.user?.id;
      const expiresAt = Date.parse(cached.session?.expiresAt ?? "");
      if (!id || typeof id !== "string" || cached.session?.userId !== id || cached.session.token !== token || !Number.isFinite(expiresAt) || expiresAt <= now()) throw new Error("Invalid cached session");
      return { user: { id } };
    } catch {
      throw new WebsiteChatIdentityUnavailableError();
    }
  }
  return {
    authOptions: {
      secondaryStorage,
      session: { storeSessionInDatabase: true, preserveSessionInDatabase: false },
      verification: { storeInDatabase: true },
      databaseHooks: {
        user: { delete: { before: async (user: { id: string }) => { await revokeUser(user.id); } } },
        session: {
          delete: {
            // Better Auth's native active-sessions list can lose a concurrent
            // login. DB-backed per-row deletion also invalidates those tokens.
            before: async (session: { token: string; expiresAt: Date }) => {
              const address = redisKey(session.token);
              // Default native session lifetime is seven days. Keep a tombstone
              // through both that window and this row's actual remaining life.
              const ttl = Math.max(7 * 86400, Math.ceil((session.expiresAt.getTime() - now()) / 1000)) + 60;
              await options.redis.eval(`
                redis.call('SET', KEYS[2], '1', 'EX', ARGV[1])
                return redis.call('DEL', KEYS[1])
              `, [address, `${address}:revoked`], [String(ttl)]);
            },
          },
        },
      },
    },
    getIdentitySession,
  };
}

export function createWebsiteChatAuthCandidateFromEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const config = parseAuthConfig(env);
  const url = env.RNR_AI_REDIS_REST_URL?.trim();
  const token = env.RNR_AI_REDIS_REST_TOKEN?.trim();
  const namespace = env.RNR_AI_REDIS_NAMESPACE?.trim();
  const encryptionKey = env.RNR_AI_REVIEW_ENCRYPTION_KEY?.trim();
  if (!url || !token || !namespace || !encryptionKey) throw new Error("Website chat authentication configuration is unavailable");
  return createWebsiteChatAuthCandidate({ redis: new Redis({ url, token, automaticDeserialization: false }), namespace, encryptionKey, secret: config.secret, baseURL: getBetterAuthBaseURL(config, env) });
}

export async function getWebsiteChatIdentitySession(headers: Headers) {
  // Guests need no Redis/auth configuration. Signed visitors fail closed even
  // when configuration is missing; only native login/session lifecycle may seed.
  if (!(headers.get("cookie") ?? "").split(";").some((part) => /^(?:__Secure-)?better-auth\.session_token\s*(?:=|$)/.test(part.trim()))) return null;
  try {
    return await createWebsiteChatAuthCandidateFromEnvironment().getIdentitySession(headers);
  } catch {
    throw new WebsiteChatIdentityUnavailableError();
  }
}
