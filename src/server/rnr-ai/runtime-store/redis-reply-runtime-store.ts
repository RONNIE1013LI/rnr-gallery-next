import { createHash, randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import type { AiControlConfig } from "../control/types";
import type {
  AiControlSnapshot,
  BacklogLease,
  BacklogResult,
  DeliveryLease,
  DeliveryResult,
  EventLease,
  EventResult,
  ReplyRuntimeStore,
  ReviewMetadata,
  ReviewMetadataInput,
  TakeoverMutation,
  TakeoverState,
  TimeWindow,
} from "./reply-runtime-store";

const HASH = /^[a-f0-9]{64}$/;
const initialControl: AiControlConfig = {
  revision: 0,
  mode: "OFF",
  timezone: "Pacific/Auckland",
  periods: [],
  override: null,
};

function requireHash(value: string) {
  if (!HASH.test(value)) throw new Error("Runtime identifier must be an HMAC hash");
}

function requireLeaseMs(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 300_000) throw new Error("Invalid lease duration");
}

const CLAIM_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if raw then
  local current = cjson.decode(raw)
  if current.result ~= nil then return nil end
  if tonumber(current.expiresAtMs) > tonumber(ARGV[1]) then return nil end
end
redis.call("SET", KEYS[1], ARGV[4], "PX", ARGV[3])
return ARGV[2]
`;

const SETTLE_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local current = cjson.decode(raw)
if current.leaseToken ~= ARGV[1] then return 0 end
if tonumber(current.expiresAtMs) <= tonumber(ARGV[2]) then return 0 end
current.result = cjson.decode(ARGV[3])
redis.call("SET", KEYS[1], cjson.encode(current), "EX", ARGV[4])
return 1
`;

const CONTROL_CAS_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
local revision = 0
if raw then revision = tonumber(cjson.decode(raw).revision) end
if revision ~= tonumber(ARGV[1]) then return 0 end
redis.call("SET", KEYS[1], ARGV[2])
return 1
`;

const REVIEW_PUT_SCRIPT = `
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
redis.call("SET", KEYS[2], ARGV[3], "EX", ARGV[2])
redis.call("ZADD", KEYS[3], ARGV[4], ARGV[5])
return 1
`;

const BACKLOG_ENQUEUE_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then return 0 end
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
redis.call("ZADD", KEYS[2], ARGV[3], ARGV[4])
return 1
`;

const BACKLOG_CLAIM_SCRIPT = `
local members = redis.call("ZRANGE", KEYS[1], 0, 9)
for _, member in ipairs(members) do
  local itemKey = KEYS[2] .. member
  local raw = redis.call("GET", itemKey)
  if not raw then
    redis.call("ZREM", KEYS[1], member)
  else
    local current = cjson.decode(raw)
    if current.result == nil and (current.leaseToken == nil or tonumber(current.expiresAtMs) <= tonumber(ARGV[1])) then
      current.leaseToken = ARGV[2]
      current.expiresAtMs = tonumber(ARGV[3])
      redis.call("SET", itemKey, cjson.encode(current), "EX", ARGV[4])
      current.key = member
      return cjson.encode(current)
    end
  end
end
return nil
`;

const BACKLOG_SETTLE_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local current = cjson.decode(raw)
if current.leaseToken ~= ARGV[1] or tonumber(current.expiresAtMs) <= tonumber(ARGV[2]) then return 0 end
current.result = cjson.decode(ARGV[3])
redis.call("SET", KEYS[1], cjson.encode(current), "EX", ARGV[4])
redis.call("ZREM", KEYS[2], ARGV[5])
return 1
`;

export class RedisReplyRuntimeStore implements ReplyRuntimeStore {
  private readonly redis: Redis;
  private readonly prefix: string;
  private readonly now: () => number;

  constructor({ redis, namespace, now = Date.now }: Readonly<{
    redis: Redis;
    namespace: string;
    now?: () => number;
  }>) {
    if (!/^[a-z0-9][a-z0-9:_-]{2,80}$/i.test(namespace)) throw new Error("Invalid Redis namespace");
    this.redis = redis;
    this.prefix = namespace;
    this.now = now;
  }

  static fromEnvironment(
    env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
    options: Readonly<{ now?: () => number }> = {},
  ) {
    const url = env.RNR_AI_REDIS_REST_URL?.trim();
    const token = env.RNR_AI_REDIS_REST_TOKEN?.trim();
    const namespace = env.RNR_AI_REDIS_NAMESPACE?.trim();
    if (!url || !token || !namespace) throw new Error("R&R AI Redis configuration is unavailable");
    return new RedisReplyRuntimeStore({
      redis: new Redis({ url, token }),
      namespace,
      now: options.now,
    });
  }

  private key(suffix: string) {
    return `${this.prefix}:${suffix}`;
  }

  async readControl(): Promise<AiControlSnapshot> {
    const config = await this.redis.get<AiControlConfig>(this.key("control"));
    return { config: config ?? initialControl, readAt: new Date(this.now()).toISOString() };
  }

  async compareAndSetControl(expectedRevision: number, next: AiControlConfig) {
    if (next.revision !== expectedRevision + 1) return false;
    return await this.redis.eval<[string, string], number>(
      CONTROL_CAS_SCRIPT,
      [this.key("control")],
      [String(expectedRevision), JSON.stringify(next)],
    ) === 1;
  }

  private async claim(suffix: string, hash: string, leaseMs: number) {
    requireHash(hash);
    requireLeaseMs(leaseMs);
    const now = this.now();
    const leaseToken = randomUUID();
    const record = JSON.stringify({ leaseToken, expiresAtMs: now + leaseMs, result: null });
    const result = await this.redis.eval<string[], string | null>(
      CLAIM_SCRIPT,
      [this.key(`${suffix}:${hash}`)],
      [String(now), leaseToken, String(leaseMs), record],
    );
    return result ? { leaseToken: result, expiresAt: new Date(now + leaseMs).toISOString() } : null;
  }

  async claimEvent(keyHash: string, leaseMs: number): Promise<EventLease | null> {
    const lease = await this.claim("event", keyHash, leaseMs);
    return lease ? { keyHash, ...lease } : null;
  }

  private async settle(suffix: string, key: string, leaseToken: string, result: EventResult | DeliveryResult) {
    requireHash(key);
    const settled = await this.redis.eval<string[], number>(
      SETTLE_SCRIPT,
      [this.key(`${suffix}:${key}`)],
      [leaseToken, String(this.now()), JSON.stringify(result), String(30 * 24 * 60 * 60)],
    );
    if (settled !== 1) throw new Error("Runtime lease is no longer valid");
  }

  async settleEvent(lease: EventLease, result: EventResult) {
    await this.settle("event", lease.keyHash, lease.leaseToken, result);
  }

  async readTakeover(conversationKeyHash: string): Promise<TakeoverState | null> {
    requireHash(conversationKeyHash);
    return this.redis.get<TakeoverState>(this.key(`takeover:${conversationKeyHash}`));
  }

  async setTakeover(input: TakeoverMutation) {
    requireHash(input.conversationKeyHash);
    await this.redis.set(this.key(`takeover:${input.conversationKeyHash}`), {
      active: input.active,
      source: input.source,
      changedAt: new Date(input.changedAt).toISOString(),
    });
  }

  async claimDelivery(key: string, leaseMs: number): Promise<DeliveryLease | null> {
    const lease = await this.claim("delivery", key, leaseMs);
    return lease ? { key, ...lease } : null;
  }

  async settleDelivery(lease: DeliveryLease, result: DeliveryResult) {
    await this.settle("delivery", lease.key, lease.leaseToken, result);
  }

  async rememberSenderEcho(providerMessageKeyHash: string, ttlSeconds: number) {
    requireHash(providerMessageKeyHash);
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 30 * 24 * 60 * 60) {
      throw new Error("Sender echo TTL is invalid");
    }
    await this.redis.set(this.key(`sender-echo:${providerMessageKeyHash}`), "1", { ex: ttlSeconds });
  }

  async hasSenderEcho(providerMessageKeyHash: string) {
    requireHash(providerMessageKeyHash);
    const marker = await this.redis.get<string | number>(this.key(`sender-echo:${providerMessageKeyHash}`));
    return marker === "1" || marker === 1;
  }

  async enqueueBacklog(controlRevision: number, window: TimeWindow) {
    const hash = createHash("sha256")
      .update(`${controlRevision}:${window.from}:${window.to}:${window.maxConversations}`)
      .digest("hex");
    const record = JSON.stringify({ controlRevision, window, leaseToken: null, expiresAtMs: 0, result: null });
    return await this.redis.eval<string[], number>(
      BACKLOG_ENQUEUE_SCRIPT,
      [this.key(`backlog-item:${hash}`), this.key("backlog-index")],
      [record, String(172_800), String(Date.parse(window.to)), hash],
    ) === 1;
  }

  async claimBacklog(leaseMs: number): Promise<BacklogLease | null> {
    requireLeaseMs(leaseMs);
    const now = this.now();
    const leaseToken = randomUUID();
    const raw = await this.redis.eval<string[], string | null>(
      BACKLOG_CLAIM_SCRIPT,
      [this.key("backlog-index"), this.key("backlog-item:")],
      [String(now), leaseToken, String(now + leaseMs), String(172_800)],
    );
    if (!raw) return null;
    const record = typeof raw === "string" ? JSON.parse(raw) as Record<string, unknown> : raw as unknown as Record<string, unknown>;
    return Object.freeze({
      key: String(record.key),
      controlRevision: Number(record.controlRevision),
      window: record.window as TimeWindow,
      leaseToken,
      expiresAt: new Date(now + leaseMs).toISOString(),
    });
  }

  async settleBacklog(lease: BacklogLease, result: BacklogResult) {
    requireHash(lease.key);
    const settled = await this.redis.eval<string[], number>(
      BACKLOG_SETTLE_SCRIPT,
      [this.key(`backlog-item:${lease.key}`), this.key("backlog-index")],
      [lease.leaseToken, String(this.now()), JSON.stringify(result), String(172_800), lease.key],
    );
    if (settled !== 1) throw new Error("Backlog lease is no longer valid");
  }

  async putEncryptedReview(
    key: string,
    ciphertext: string,
    ttlSeconds: 172800 = 172_800,
    metadata?: ReviewMetadataInput,
  ) {
    requireHash(key);
    if (ttlSeconds !== 172_800 || !metadata) throw new Error("Encrypted review requires exact retention and metadata");
    requireHash(metadata.conversationKeyHash);
    const expiresAt = new Date(this.now() + ttlSeconds * 1_000).toISOString();
    const full: ReviewMetadata = { key, ...metadata, expiresAt };
    await this.redis.eval<string[], number>(
      REVIEW_PUT_SCRIPT,
      [this.key(`review:${key}`), this.key(`review-meta:${key}`), this.key("review-index")],
      [ciphertext, String(ttlSeconds), JSON.stringify(full), String(Date.parse(metadata.createdAt)), key],
    );
  }

  async listReviewMetadata(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid review limit");
    const keys = await this.redis.zrange<string[]>(this.key("review-index"), 0, limit - 1, { rev: true });
    const metadata = await Promise.all(keys.map((key) => this.redis.get<ReviewMetadata>(this.key(`review-meta:${key}`))));
    const expired = keys.filter((_, index) => !metadata[index]);
    if (expired.length) await this.redis.zrem(this.key("review-index"), ...expired);
    return metadata.filter((entry): entry is ReviewMetadata => Boolean(entry));
  }

  async readEncryptedReview(key: string) {
    requireHash(key);
    return this.redis.get<string>(this.key(`review:${key}`));
  }

  async deleteReview(key: string) {
    requireHash(key);
    await this.redis.del(this.key(`review:${key}`), this.key(`review-meta:${key}`));
    await this.redis.zrem(this.key("review-index"), key);
  }

  async putEphemeralSecret(keyHash: string, ciphertext: string, ttlSeconds: number) {
    requireHash(keyHash);
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 900) {
      throw new Error("Ephemeral secret TTL must not exceed 15 minutes");
    }
    await this.redis.set(this.key(`ephemeral:${keyHash}`), ciphertext, { ex: ttlSeconds });
  }

  async readEphemeralSecret(keyHash: string) {
    requireHash(keyHash);
    return this.redis.get<string>(this.key(`ephemeral:${keyHash}`));
  }

  async deleteEphemeralSecret(keyHash: string) {
    requireHash(keyHash);
    await this.redis.del(this.key(`ephemeral:${keyHash}`));
  }
}
