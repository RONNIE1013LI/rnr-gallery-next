import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { Redis } from "@upstash/redis";
import type {
  CustomerServiceRepository,
  HashedConversationEvent,
  SafeInboxItem,
  SafeTimelineEvent,
  SafeWebsiteReview,
} from "@/server/customer-service/repositories/customer-service-repository";
import type { CustomerInboxIdentity } from "@/server/customer-service/identity/customer-identity";
import type { WebsitePublicUpdateRecord } from "@/server/customer-service/website/public-updates";
import {
  createWebsiteReviewSelectorRecord,
  verifyWebsiteReviewSelector,
} from "@/server/customer-service/website/review-selector";
import { validateReplyPublicSurface } from "@/server/customer-service/website/output-safety-validator";
import { localDateScopeKey } from "@/server/customer-service/usage-cost";
import {
  createReviewAlertToken,
  hashReviewAlertToken,
  type WebsiteReviewAlertRepository,
  type ClaimedWebsiteReviewAlert,
} from "@/server/customer-service/website/review-alert-service";
import { REVIEW_ALERT_AUTOMATIC_RECOVERY_MAX_AGE_MS } from "@/server/customer-service/website/review-alert-policy";
import {
  createSharedReplyProof,
  verifySharedReplyProof,
} from "./shared-reply-proof";
import type { RnrAiDecision } from "../types";

const RETENTION_MS = 30 * 86400_000;
const SESSION_MS = 7 * 86400_000;
const LEASE_MS = 240_000;
const HASH = /^[a-f0-9]{64}$/;
export type WebsiteRedisTransport = {
  get(key: string): Promise<string | null>;
  eval(script: string, keys: string[], args: string[]): Promise<number>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
};
type Write = { key: string; value: string; ttl: number };
type Rate = { key: string; window: number; limit: number };
type Mutation = {
  checks: [string, string | null][];
  writes: Write[];
  rates: Rate[];
  now: number;
  deadline?: number;
  alert?: { id: string; score: number | null };
  pending?: { id: string; score: number | null };
  activity?: { id: string; at: number };
};
// Every read participating in a mutation is compared before any write or rate charge.
// Payloads remain encrypted; Lua sees only opaque ciphertext and rate timestamps.
export const WEBSITE_CAS_SCRIPT = `
local input = cjson.decode(ARGV[1])
for _, check in ipairs(input.checks) do
  local current = redis.call('GET', check[1])
  local expected = check[2]
  if expected == cjson.null then
    if current then return 0 end
  elseif current ~= expected then return 0 end
end
if input.deadline then
  local time = redis.call('TIME')
  local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
  if tonumber(input.deadline) <= now then return -2 end
end
for _, rate in ipairs(input.rates) do
  local count = redis.call('ZCOUNT', rate.key, '(' .. tostring(input.now - rate.window), '+inf')
  if count >= rate.limit then return -1 end
end
for _, rate in ipairs(input.rates) do
  redis.call('ZREMRANGEBYSCORE', rate.key, '-inf', input.now - rate.window)
  redis.call('ZADD', rate.key, input.now, ARGV[2])
  redis.call('PEXPIRE', rate.key, rate.window)
end
for _, write in ipairs(input.writes) do
  if write.ttl == 0 then redis.call('SET', write.key, write.value)
  else redis.call('SET', write.key, write.value, 'PX', write.ttl) end
end
if input.activity then
  redis.call('ZADD', KEYS[1], input.activity.at, input.activity.id)
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', input.now - ${RETENTION_MS})
end
if input.pending then
  if input.pending.score == cjson.null then redis.call('ZREM', KEYS[2], input.pending.id)
  else redis.call('ZADD', KEYS[2], input.pending.score, input.pending.id) end
end
if input.alert then
  if input.alert.score == cjson.null then redis.call('ZREM', KEYS[3], input.alert.id)
  else redis.call('ZADD', KEYS[3], input.alert.score, input.alert.id) end
end
return 1
`;
type Event = Omit<WebsitePublicUpdateRecord, "createdAt"> & {
  createdAt: string;
};
export type WebsiteProviderBudget = {
  dailyHardStopMicrousd: number;
  totalHardStopMicrousd: number;
};
type Turn = {
  budget?: { lease: string; day: string; settled: boolean; charges: string[] };
  id: string;
  messageId: string;
  event: HashedConversationEvent;
  status: "pending" | "leased" | "published" | "review" | "cancelled";
  lease?: string;
  deadline?: number;
  attempts: number;
};
type Alert = {
  status: "pending" | "leased" | "retry_wait" | "sent" | "failed";
  attempts: number;
  openedAt: number;
  nextDue: number;
  lease?: string;
  deadline?: number;
  payloadDigest?: string;
  providerMessageId?: string;
};
type Review = {
  alert: Alert;
  id: string;
  turnId: string;
  generation: number;
  selector: string;
  expiresAt: number;
  reason: SafeWebsiteReview["reason"];
  draft: string | null;
  resolvedText?: string;
};
type Conversation = {
  expiresAt: number;
  id: string;
  identity: CustomerInboxIdentity;
  events: Event[];
  turns: Turn[];
  latestTurnId: string;
  takeover: boolean;
  activity: number;
  orderingKey: string;
  review: Review | null;
};
type Session = {
  conversationId: string;
  externalConversationKeyHash: string;
  identity: CustomerInboxIdentity;
  expiresAt: number;
};
export type WebsiteTurnLease = {
  conversationId: string;
  turnId: string;
  leaseToken: string;
  deadline: number;
  takeover: boolean;
  attempts: number;
  event: HashedConversationEvent;
  context: readonly {
    role: "customer" | "staff";
    text: string;
    receivedAt: string;
  }[];
};
type Contract = Pick<
  CustomerServiceRepository,
  | "resolveWebsiteSession"
  | "ingestConversationEvent"
  | "listWebsitePublicUpdates"
  | "listQueue"
  | "loadEarlierInboxTimeline"
  | "resolveReplyAssistantInbox"
  | "answerWebsiteReview"
>;

export class RedisWebsiteRepository
  implements Contract, WebsiteReviewAlertRepository
{
  private readonly redis: WebsiteRedisTransport;
  private readonly namespace: string;
  private readonly secret: string;
  private readonly cipherKey: Buffer;
  private readonly reviewLinkSecret: string;
  private readonly now: () => number;
  constructor(input: {
    redis: WebsiteRedisTransport;
    namespace: string;
    secret: string;
    reviewLinkSecret?: string;
    now?: () => number;
  }) {
    if (
      !/^[a-z0-9][a-z0-9:_-]{2,80}$/i.test(input.namespace) ||
      input.secret.trim().length < 32
    )
      throw Error("website_redis_configuration_unavailable");
    this.reviewLinkSecret = input.reviewLinkSecret ?? input.secret;
    if (this.reviewLinkSecret.length < 32)
      throw Error("website_review_link_secret_invalid");
    this.redis = input.redis;
    this.namespace = `${input.namespace}:website:v1`;
    this.secret = input.secret;
    this.cipherKey = createHash("sha256")
      .update(`rnr-website-record-encryption\0${input.secret}`)
      .digest();
    this.now = input.now ?? Date.now;
  }
  static fromEnvironment(
    env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  ) {
    const url = env.RNR_AI_REDIS_REST_URL?.trim(),
      token = env.RNR_AI_REDIS_REST_TOKEN?.trim(),
      namespace = env.RNR_AI_REDIS_NAMESPACE?.trim(),
      secret = env.RNR_AI_REVIEW_ENCRYPTION_KEY?.trim();
    if (!url || !token || !namespace || !secret)
      throw Error("website_redis_configuration_unavailable");
    const redis = new Redis({
      url,
      token,
      automaticDeserialization: false,
      responseEncoding: false,
    });
    return new RedisWebsiteRepository({
      namespace,
      secret,
      reviewLinkSecret: env.REPLY_ASSISTANT_REVIEW_LINK_SECRET,
      redis: {
        get: (key) => redis.get<string>(key),
        eval: (script, keys, args) =>
          redis.eval<string[], number>(script, keys, args),
        zrange: (key, start, stop) =>
          redis.zrange<string[]>(key, start, stop, { rev: true }),
      },
    });
  }
  private key(kind: string, value: string) {
    return `${this.namespace}:${kind}:${createHmac("sha256", this.secret).update(`${kind}\0${value}`).digest("hex")}`;
  }
  private seal(key: string, value: unknown) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.cipherKey, iv);
    cipher.setAAD(Buffer.from(key));
    return Buffer.concat([
      iv,
      cipher.update(JSON.stringify(value)),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString("base64url");
  }
  private open<T>(key: string, raw: string): T {
    try {
      const b = Buffer.from(raw, "base64url"),
        d = createDecipheriv("aes-256-gcm", this.cipherKey, b.subarray(0, 12));
      d.setAAD(Buffer.from(key));
      d.setAuthTag(b.subarray(-16));
      return JSON.parse(
        Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString(),
      ) as T;
    } catch {
      throw Error("website_redis_record_invalid");
    }
  }
  private async read<T>(key: string) {
    const raw = await this.redis.get(key);
    const value = raw ? this.open<T>(key, raw) : null;
    if (
      value &&
      key.startsWith(`${this.namespace}:conversation:`) &&
      (value as unknown as Conversation).expiresAt <= this.now()
    )
      return { raw, value: null };
    return { raw, value };
  }
  private write(key: string, value: unknown, ttl = RETENTION_MS): Write {
    // A conversation epoch has a hard retention deadline; activity never extends it.
    if (key.startsWith(`${this.namespace}:conversation:`)) {
      ttl = Math.min(ttl, (value as Conversation).expiresAt - this.now());
      if (ttl <= 0) throw Error("website_conversation_expired_retry_required");
    }
    return {
      key,
      value: this.seal(key, value),
      ttl: ttl === 0 ? 0 : Math.max(1, Math.floor(ttl)),
    };
  }
  private commit(input: Mutation) {
    return this.redis.eval(
      WEBSITE_CAS_SCRIPT,
      [
        `${this.namespace}:activity`,
        `${this.namespace}:pending`,
        `${this.namespace}:alerts`,
      ],
      [JSON.stringify(input), randomUUID()],
    );
  }
  private id(identity: CustomerInboxIdentity) {
    return createHash("sha256")
      .update(`website\0${identity.kind}\0${identity.keyHash}`)
      .digest("hex");
  }
  private fresh(
    id: string,
    identity: CustomerInboxIdentity,
    now: number,
  ): Conversation {
    return {
      id,
      expiresAt: now + RETENTION_MS,
      identity,
      events: [],
      turns: [],
      latestTurnId: "",
      takeover: false,
      activity: now,
      orderingKey: "",
      review: null,
    };
  }
  private append(
    c: Conversation,
    event: Omit<Event, "orderingKey">,
    now: number,
  ) {
    // Monotonic microsecond strings retain the existing encrypted public cursor contract.
    let micros = BigInt(now) * BigInt(1000);
    if (c.orderingKey) {
      const previous =
        BigInt(Date.parse(c.orderingKey)) * BigInt(1000) +
        BigInt(c.orderingKey.slice(-4, -1));
      if (micros <= previous) micros = previous + BigInt(1);
    }
    const orderingKey = new Date(Number(micros / BigInt(1000)))
      .toISOString()
      .replace(
        /\d{3}Z$/,
        `${String(micros % BigInt(1000000)).padStart(6, "0")}Z`,
      );
    c.orderingKey = orderingKey;
    c.events.push({ ...event, orderingKey });
    c.activity = now;
  }
  private prune(c: Conversation, now: number) {
    c.events = c.events.filter(
      (e) => Date.parse(e.createdAt) > now - RETENTION_MS,
    );
    const ids = new Set(c.events.map((e) => e.id));
    c.turns = c.turns.filter((t) => ids.has(t.messageId));
    if (
      c.events.length >= 3000 ||
      Buffer.byteLength(JSON.stringify(c)) > 1500000
    )
      throw Error("website_conversation_capacity_retry_required");
  }
  async resolveWebsiteSession(
    input: Parameters<Contract["resolveWebsiteSession"]>[0],
  ) {
    if (!HASH.test(input.sessionTokenHash)) return null;
    const { value: s } = await this.read<Session>(
      this.key("session", input.sessionTokenHash),
    );
    if (!s || s.expiresAt <= input.now.getTime()) return null;
    const { value: c } = await this.read<Conversation>(
      this.key("conversation", s.conversationId),
    );
    return c
      ? {
          conversationId: s.conversationId,
          expiresAt: new Date(s.expiresAt),
          identity: s.identity,
        }
      : null;
  }
  async ingestConversationEvent(
    input: HashedConversationEvent,
  ): ReturnType<Contract["ingestConversationEvent"]> {
    if (
      input.channel !== "website" ||
      input.role !== "customer" ||
      !input.websiteRateLimit ||
      input.attachments.length ||
      !input.text?.trim() ||
      input.text.length > 8000
    )
      throw Error("website_event_invalid");
    const rate = input.websiteRateLimit,
      now = this.now();
    for (const hash of [
      input.externalConversationKeyHash,
      input.externalMessageKeyHash,
      input.identity.keyHash,
      rate.sessionKeyHash,
      rate.networkKeyHash,
    ])
      if (!HASH.test(hash)) throw Error("website_identity_invalid");
    if (!input.identity.kind.startsWith("website_"))
      throw Error("website_identity_invalid");
    const expires = rate.sessionExpiresAt.getTime();
    if (expires <= now || expires > now + SESSION_MS + 1000)
      throw Error("website_session_expiry_invalid");
    const id = this.id(input.identity),
      key = this.key("conversation", id),
      sessionKey = this.key("session", rate.sessionKeyHash),
      technicalKey = this.key("technical", input.externalConversationKeyHash),
      duplicateKey = this.key("message", input.externalMessageKeyHash);
    for (let attempt = 0; attempt < 12; attempt++) {
      const [record, session, technical, duplicate] = await Promise.all([
        this.read<Conversation>(key),
        this.read<Session>(sessionKey),
        this.read<{ id: string }>(technicalKey),
        this.read<{ id: string }>(duplicateKey),
      ]);
      if (
        (session.value &&
          (session.value.conversationId !== id ||
            session.value.externalConversationKeyHash !==
              input.externalConversationKeyHash ||
            session.value.expiresAt <= now)) ||
        (technical.value && technical.value.id !== id) ||
        (duplicate.value && duplicate.value.id !== id)
      )
        throw Error("customer_service_conversation_identity_mismatch");
      if (duplicate.value) return { status: "duplicate" };
      const c = record.value ?? this.fresh(id, input.identity, now);
      this.prune(c, now);
      const messageId = randomUUID(),
        turnId = randomUUID();
      for (const old of c.turns)
        if (old.status === "pending" || old.status === "leased")
          old.status = "cancelled";
      const turn: Turn = {
        id: turnId,
        messageId,
        event: input,
        status: "pending",
        attempts: 0,
      };
      c.turns.push(turn);
      c.latestTurnId = turnId;
      // An open review follows the newest customer question; old selectors become invalid.
      if (c.review && !c.review.resolvedText) c.review = null;
      this.append(
        c,
        {
          source: "event",
          id: messageId,
          messageKeyHash: input.externalMessageKeyHash,
          role: "customer",
          text: input.text.trim(),
          createdAt: new Date(now).toISOString(),
          state: "pending",
        },
        now,
      );
      const sessionExpires = session.value?.expiresAt ?? expires;
      turn.event = {
        ...input,
        websiteRateLimit: {
          ...rate,
          sessionExpiresAt: new Date(sessionExpires),
        },
      };
      const rates: Rate[] = [
        {
          key: this.key("rate-sm", rate.sessionKeyHash),
          window: 60000,
          limit: 5,
        },
        {
          key: this.key("rate-sh", rate.sessionKeyHash),
          window: 3600000,
          limit: 30,
        },
        {
          key: this.key("rate-st", rate.sessionKeyHash),
          window: SESSION_MS,
          limit: 100,
        },
        {
          key: this.key("rate-nm", rate.networkKeyHash),
          window: 60000,
          limit: 10,
        },
        {
          key: this.key("rate-nh", rate.networkKeyHash),
          window: 3600000,
          limit: 60,
        },
      ];
      const result = await this.commit({
        now,
        checks: [
          [key, record.raw],
          [sessionKey, session.raw],
          [technicalKey, technical.raw],
          [duplicateKey, duplicate.raw],
        ],
        writes: [
          this.write(key, c),
          this.write(
            sessionKey,
            {
              conversationId: id,
              externalConversationKeyHash: input.externalConversationKeyHash,
              identity: input.identity,
              expiresAt: sessionExpires,
            },
            sessionExpires - now,
          ),
          this.write(technicalKey, { id }),
          this.write(duplicateKey, { id }),
          this.write(this.key("turn", turnId), { id }),
        ],
        rates,
        pending: { id, score: -now },
        activity: { id, at: now },
      });
      if (result === -1) return { status: "rate_limited" };
      if (result === 1)
        return {
          status: "turn_pending",
          messageId,
          turnId,
          debounceUntil: new Date(now),
        };
    }
    throw Error("website_redis_conflict_retry_required");
  }
  async listWebsitePublicUpdates(
    input: Parameters<Contract["listWebsitePublicUpdates"]>[0],
  ) {
    if (
      !HASH.test(input.conversationId) ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 101
    )
      throw Error("website_public_updates_input_invalid");
    const { value: c } = await this.read<Conversation>(
      this.key("conversation", input.conversationId),
    );
    const after = input.after;
    return (c?.events ?? [])
      .filter((e) => Date.parse(e.createdAt) > this.now() - RETENTION_MS)
      .filter(
        (e) =>
          !after ||
          e.orderingKey > after.orderingKey ||
          (e.orderingKey === after.orderingKey &&
            ((e.source === "assistant" ? 1 : 0) >
              (after.source === "assistant" ? 1 : 0) ||
              (e.source === after.source && e.id > after.id))),
      )
      .slice(0, input.limit)
      .map((e) => ({ ...e, createdAt: new Date(e.createdAt) }));
  }
  async claimTurn(turnId: string): Promise<WebsiteTurnLease | null> {
    const { value: locator } = await this.read<{ id: string }>(
      this.key("turn", turnId),
    );
    if (!locator) return null;
    const key = this.key("conversation", locator.id);
    for (let i = 0; i < 12; i++) {
      const { raw, value: c } = await this.read<Conversation>(key),
        now = this.now();
      if (!c) return null;
      const t = c.turns.find((t) => t.id === turnId);
      if (
        !t ||
        c.latestTurnId !== turnId ||
        t.status === "published" ||
        t.status === "cancelled" ||
        t.status === "review" ||
        (t.status === "leased" && (t.deadline ?? 0) > now)
      )
        return null;
      if (
        new Date(t.event.websiteRateLimit!.sessionExpiresAt).getTime() <= now
      ) {
        t.status = "cancelled";
        if (
          (await this.commit({
            now,
            checks: [[key, raw]],
            writes: [this.write(key, c)],
            rates: [],
            pending: { id: c.id, score: null },
          })) === 1
        )
          return null;
        continue;
      }
      const token = randomUUID();
      t.lease = token;
      t.deadline = now + LEASE_MS;
      t.status = "leased";
      t.attempts++;
      if (
        (await this.commit({
          now,
          checks: [[key, raw]],
          writes: [this.write(key, c)],
          rates: [],
          pending: { id: c.id, score: -t.deadline },
        })) === 1
      )
        return {
          conversationId: c.id,
          turnId,
          leaseToken: token,
          deadline: t.deadline,
          takeover: c.takeover,
          attempts: t.attempts,
          event: t.event,
          context: c.events
            .filter(
              (e) =>
                e.state !== "review" &&
                Date.parse(e.createdAt) > now - RETENTION_MS,
            )
            .map((e) => ({
              role: e.role === "customer" ? "customer" : "staff",
              text: e.text,
              receivedAt: e.createdAt,
            })),
        };
    }
    throw Error("website_redis_conflict_retry_required");
  }
  async reserveProviderBudget(
    lease: WebsiteTurnLease,
    limits: WebsiteProviderBudget,
    reservation = 1000,
    chargeId = lease.leaseToken,
  ) {
    if (!Number.isSafeInteger(reservation) || reservation < 1)
      throw Error("website_budget_reservation_invalid");
    if (
      !Number.isSafeInteger(limits.dailyHardStopMicrousd) ||
      !Number.isSafeInteger(limits.totalHardStopMicrousd) ||
      limits.dailyHardStopMicrousd < 1 ||
      limits.totalHardStopMicrousd < 1
    )
      throw Error("website_budget_invalid");
    const key = this.key("conversation", lease.conversationId),
      day = localDateScopeKey(new Date(this.now())),
      dailyKey = this.key("budget", day),
      totalKey = this.key("budget", "total");
    for (let i = 0; i < 12; i++) {
      const [record, daily, total] = await Promise.all([
          this.read<Conversation>(key),
          this.read<number>(dailyKey),
          this.read<number>(totalKey),
        ]),
        c = record.value,
        now = this.now(),
        t = c?.turns.find((t) => t.id === lease.turnId);
      if (
        !c ||
        !t ||
        c.latestTurnId !== t.id ||
        c.takeover ||
        t.status !== "leased" ||
        t.lease !== lease.leaseToken ||
        (t.deadline ?? 0) <= now ||
        new Date(t.event.websiteRateLimit!.sessionExpiresAt).getTime() <= now
      )
        return false;
      if (
        t.budget?.lease === lease.leaseToken &&
        t.budget.charges.includes(chargeId)
      )
        return true;
      // Match the existing admission reservation. Unknown/failed calls retain the charge.
      if (
        (daily.value ?? 0) + reservation > limits.dailyHardStopMicrousd ||
        (total.value ?? 0) + reservation > limits.totalHardStopMicrousd
      )
        return false;
      if (t.budget?.lease !== lease.leaseToken)
        t.budget = {
          lease: lease.leaseToken,
          day,
          settled: false,
          charges: [],
        };
      if (t.budget.charges.length >= 16) return false;
      t.budget.charges.push(chargeId);
      const committed = await this.commit({
        now,
        deadline: Math.min(
          lease.deadline,
          new Date(t.event.websiteRateLimit!.sessionExpiresAt).getTime(),
        ),
        checks: [
          [key, record.raw],
          [dailyKey, daily.raw],
          [totalKey, total.raw],
        ],
        writes: [
          this.write(key, c),
          this.write(dailyKey, (daily.value ?? 0) + reservation, 48 * 3600000),
          this.write(totalKey, (total.value ?? 0) + reservation, 0),
        ],
        rates: [],
      });
      if (committed === -2) return false;
      if (committed === 1) return true;
    }
    throw Error("website_redis_conflict_retry_required");
  }
  async settleProviderBudget(
    lease: WebsiteTurnLease,
    costMicrousd: number | null,
  ) {
    if (costMicrousd === null) return;
    if (!Number.isSafeInteger(costMicrousd) || costMicrousd < 0)
      throw Error("website_budget_cost_invalid");
    const key = this.key("conversation", lease.conversationId);
    for (let i = 0; i < 12; i++) {
      const { raw, value: c } = await this.read<Conversation>(key),
        t = c?.turns.find((t) => t.id === lease.turnId),
        b = t?.budget;
      if (!c || !b || b.lease !== lease.leaseToken || b.settled) return;
      const dailyKey = this.key("budget", b.day),
        totalKey = this.key("budget", "total");
      const [daily, total] = await Promise.all([
        this.read<number>(dailyKey),
        this.read<number>(totalKey),
      ]);
      b.settled = true;
      const extra = Math.max(0, costMicrousd - 1000);
      if (
        (await this.commit({
          now: this.now(),
          checks: [
            [key, raw],
            [dailyKey, daily.raw],
            [totalKey, total.raw],
          ],
          writes: [
            this.write(key, c),
            this.write(dailyKey, (daily.value ?? 0) + extra, 48 * 3600000),
            this.write(totalKey, (total.value ?? 0) + extra, 0),
          ],
          rates: [],
        })) === 1
      )
        return;
    }
    throw Error("website_redis_conflict_retry_required");
  }
  async settleTurn(
    lease: WebsiteTurnLease,
    decision: RnrAiDecision | null,
    reviewReason?: SafeWebsiteReview["reason"],
  ): Promise<"published" | "review" | "cancelled"> {
    const key = this.key("conversation", lease.conversationId);
    for (let i = 0; i < 12; i++) {
      const { raw, value: c } = await this.read<Conversation>(key),
        now = this.now();
      if (!c) return "cancelled";
      const t = c.turns.find((t) => t.id === lease.turnId);
      if (
        !t ||
        t.status !== "leased" ||
        t.lease !== lease.leaseToken ||
        (t.deadline ?? 0) <= now ||
        c.latestTurnId !== t.id
      )
        return "cancelled";
      const sessionExpiry = new Date(
        t.event.websiteRateLimit!.sessionExpiresAt,
      ).getTime();
      if (sessionExpiry <= now) return "cancelled";
      if (decision?.risk === "GREEN" && decision.nextAction === "NO_REPLY") {
        t.status = "cancelled";
        if (
          (await this.commit({
            now,
            deadline: Math.min(lease.deadline, sessionExpiry),
            checks: [[key, raw]],
            writes: [this.write(key, c)],
            rates: [],
            pending: { id: c.id, score: null },
          })) === 1
        )
          return "cancelled";
        continue;
      }
      const text = decision?.replyText ?? "";
      const proof = decision
        ? createSharedReplyProof({
            secret: this.secret,
            attemptId: lease.leaseToken,
            messageId: t.messageId,
            text,
            decision,
          })
        : null;
      const publish =
        !c.takeover &&
        proof &&
        validateReplyPublicSurface(text).ok &&
        text.length <= 8000 &&
        verifySharedReplyProof({
          secret: this.secret,
          attemptId: lease.leaseToken,
          messageId: t.messageId,
          text,
          proof,
        });
      const writes: Write[] = [];
      if (publish) {
        t.status = "published";
        c.review = null;
        this.append(
          c,
          {
            source: "assistant",
            id: randomUUID(),
            role: "assistant",
            text,
            createdAt: new Date(now).toISOString(),
            state: "committed_assistant",
          },
          now,
        );
      } else {
        t.status = "review";
        c.takeover = true;
        const reviewId = randomUUID(),
          generation = (c.review?.generation ?? 0) + 1;
        const selector = createWebsiteReviewSelectorRecord({
          reviewId,
          generation,
          secret: this.secret,
          now: new Date(now),
        });
        c.review = {
          alert: {
            status: "pending",
            attempts: 0,
            openedAt: now,
            nextDue: now,
          },
          id: reviewId,
          turnId: t.id,
          generation,
          selector: selector.selector,
          expiresAt: selector.expiresAt.getTime(),
          reason:
            reviewReason ??
            (!decision
              ? "provider_error"
              : decision.risk === "GREEN"
                ? "output_blocked"
                : "high_risk"),
          draft: text || null,
        };
        writes.push(
          this.write(
            this.key("selector", selector.selector),
            { id: c.id, reviewId },
            selector.expiresAt.getTime() - now,
          ),
        );
        writes.push(
          this.write(this.key("alert", reviewId), { id: c.id, reviewId }),
        );
        const token = createReviewAlertToken({
          reviewId,
          secret: this.reviewLinkSecret,
        });
        writes.push(
          this.write(this.key("deeplink", hashReviewAlertToken(token)), {
            id: c.id,
            reviewId,
          }),
        );
        this.append(
          c,
          {
            source: "event",
            id: randomUUID(),
            role: "assistant",
            text: "Your message is waiting for our team to review.",
            createdAt: new Date(now).toISOString(),
            state: "review",
          },
          now,
        );
      }
      writes.push(this.write(key, c));
      const committed = await this.commit({
        now,
        deadline: Math.min(lease.deadline, sessionExpiry),
        checks: [[key, raw]],
        writes,
        rates: [],
        pending: { id: c.id, score: null },
        ...(!publish && c.review
          ? { alert: { id: c.review.id, score: -now } }
          : {}),
        activity: { id: c.id, at: now },
      });
      if (committed === -2) return "cancelled";
      if (committed === 1) return publish ? "published" : "review";
    }
    throw Error("website_redis_conflict_retry_required");
  }
  async setWebsiteTakeover(inboxId: string, active: boolean, now = new Date()) {
    const key = this.key("conversation", inboxId);
    for (let i = 0; i < 12; i++) {
      const { raw, value: c } = await this.read<Conversation>(key);
      if (!c) return false;
      c.takeover = active;
      c.activity = now.getTime();
      if (
        (await this.commit({
          now: now.getTime(),
          checks: [[key, raw]],
          writes: [this.write(key, c)],
          rates: [],
          activity: { id: c.id, at: c.activity },
        })) === 1
      )
        return true;
    }
    throw Error("website_redis_conflict_retry_required");
  }
  async answerWebsiteReview(
    input: Parameters<Contract["answerWebsiteReview"]>[0],
  ): ReturnType<Contract["answerWebsiteReview"]> {
    const text = input.text.trim(),
      now = input.now.getTime();
    if (
      !input.actorUserId.trim() ||
      !text ||
      Array.from(text).length > 2000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
    )
      return { status: "unavailable" };
    const { value: locator } = await this.read<{
      id: string;
      reviewId: string;
    }>(this.key("selector", input.reviewSelector));
    if (!locator) return { status: "unavailable" };
    const key = this.key("conversation", locator.id);
    for (let i = 0; i < 12; i++) {
      const { raw, value: c } = await this.read<Conversation>(key),
        r = c?.review;
      if (
        !c ||
        !r ||
        r.id !== locator.reviewId ||
        r.turnId !== c.latestTurnId ||
        !verifyWebsiteReviewSelector({
          reviewId: r.id,
          generation: r.generation,
          secret: this.secret,
          selector: input.reviewSelector,
          now: input.now,
        })
      )
        return { status: "unavailable" };
      if (r.resolvedText)
        return {
          status: r.resolvedText === text ? "duplicate" : "unavailable",
        };
      r.resolvedText = text;
      c.takeover = true;
      for (const t of c.turns)
        if (
          t.status === "leased" ||
          t.status === "pending" ||
          t.status === "review"
        )
          t.status = "cancelled";
      this.append(
        c,
        {
          source: "event",
          id: randomUUID(),
          role: "staff",
          text,
          createdAt: new Date(now).toISOString(),
          state: "human_outbound",
        },
        now,
      );
      if (
        (await this.commit({
          now,
          checks: [[key, raw]],
          writes: [this.write(key, c)],
          rates: [],
          activity: { id: c.id, at: now },
        })) === 1
      )
        return { status: "sent" };
    }
    throw Error("website_redis_conflict_retry_required");
  }
  private timeline(c: Conversation): SafeTimelineEvent[] {
    return c.events
      .filter(
        (e) =>
          e.state !== "review" &&
          Date.parse(e.createdAt) > this.now() - RETENTION_MS,
      )
      .map((e) => ({
        eventId: `${e.source}:${e.id}`,
        role: e.role,
        text: e.text,
        receivedAt: e.createdAt,
      }));
  }
  private item(c: Conversation): SafeInboxItem {
    const timeline = this.timeline(c),
      turn = c.turns.find((t) => t.id === c.latestTurnId),
      review = c.review && !c.review.resolvedText ? c.review : null;
    return {
      inboxId: c.id,
      channel: "website",
      latestMessageId: turn?.messageId ?? "",
      lastActivityAt: new Date(c.activity).toISOString(),
      unreadCount:
        turn?.status === "pending" || turn?.status === "leased" || review
          ? 1
          : 0,
      status: review ? "human_review_required" : (turn?.status ?? "pending"),
      latestAttemptId: null,
      draftText: review?.draft ?? null,
      gateResult: review?.reason ?? null,
      attachmentCount: 0,
      imageAnalysisStatus: "not_applicable",
      imageAssessmentSummary: null,
      humanReplyReceived: !review && timeline.at(-1)?.role === "staff",
      websiteReview: review
        ? {
            selector: review.selector,
            reason: review.reason,
            alertStatus: review.alert.status,
          }
        : null,
      timeline: timeline.slice(-50),
      hasEarlierTimeline: timeline.length > 50,
    };
  }
  async listQueue(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw Error("website_queue_limit_invalid");
    const ids = await this.redis.zrange(
      `${this.namespace}:activity`,
      0,
      limit - 1,
    );
    const records = await Promise.all(
      ids.map((id) => this.read<Conversation>(this.key("conversation", id))),
    );
    return {
      items: records.flatMap((r) =>
        r.value && r.value.activity > this.now() - RETENTION_MS
          ? [this.item(r.value)]
          : [],
      ),
    };
  }
  async resolveReplyAssistantInbox(inboxId: string) {
    if (!HASH.test(inboxId)) return null;
    const { value: c } = await this.read<Conversation>(
      this.key("conversation", inboxId),
    );
    return c
      ? { channel: "website" as const, identityKeyHash: c.identity.keyHash }
      : null;
  }
  async loadEarlierInboxTimeline(
    input: Parameters<Contract["loadEarlierInboxTimeline"]>[0],
  ) {
    if (
      !HASH.test(input.inboxId) ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 50
    )
      throw Error("reply_assistant_timeline_cursor_invalid");
    const { value: c } = await this.read<Conversation>(
      this.key("conversation", input.inboxId),
    );
    if (!c) throw Error("reply_assistant_inbox_not_found");
    const timeline = this.timeline(c),
      index = timeline.findIndex((e) => e.eventId === input.cursor);
    if (index < 0) throw Error("reply_assistant_timeline_cursor_invalid");
    const events = timeline.slice(Math.max(0, index - input.limit), index);
    return {
      events,
      cursor: events[0]?.eventId ?? null,
      hasEarlier: index > input.limit,
    };
  }
  async ownsWebsiteReviewSelector(selector: string) {
    return Boolean((await this.read(this.key("selector", selector))).value);
  }
  async resolveWebsiteReviewDeepLink(
    input: Parameters<
      CustomerServiceRepository["resolveWebsiteReviewDeepLink"]
    >[0],
  ) {
    if (!HASH.test(input.tokenHash)) return null;
    const { value: locator } = await this.read<{
      id: string;
      reviewId: string;
    }>(this.key("deeplink", input.tokenHash));
    if (!locator) return null;
    const { value: c } = await this.read<Conversation>(
      this.key("conversation", locator.id),
    );
    if (
      !c?.review ||
      c.review.id !== locator.reviewId ||
      c.review.resolvedText ||
      c.review.expiresAt <= input.now.getTime()
    )
      return null;
    return { selector: c.review.selector, item: this.item(c) };
  }
  async claimDueReviewAlert(
    input: Parameters<WebsiteReviewAlertRepository["claimDueReviewAlert"]>[0],
  ): Promise<ClaimedWebsiteReviewAlert | null> {
    const now = input.now.getTime(),
      deadline = input.leaseExpiresAt.getTime();
    if (deadline <= now || deadline > now + 300000)
      throw Error("website_alert_lease_invalid");
    const ids = await this.redis.zrange(`${this.namespace}:alerts`, 0, 99);
    for (const id of ids) {
      const { value: locator } = await this.read<{
        id: string;
        reviewId: string;
      }>(this.key("alert", id));
      if (!locator) {
        await this.commit({
          now,
          checks: [],
          writes: [],
          rates: [],
          alert: { id, score: null },
        });
        continue;
      }
      const key = this.key("conversation", locator.id);
      for (let i = 0; i < 12; i++) {
        const { raw, value: c } = await this.read<Conversation>(key),
          r = c?.review,
          a = r?.alert;
        if (
          !c ||
          !r ||
          r.id !== id ||
          r.resolvedText ||
          !a ||
          a.status === "sent" ||
          a.status === "failed"
        ) {
          await this.commit({
            now,
            checks: [[key, raw]],
            writes: [],
            rates: [],
            alert: { id, score: null },
          });
          break;
        }
        if (
          now - a.openedAt >= REVIEW_ALERT_AUTOMATIC_RECOVERY_MAX_AGE_MS ||
          a.attempts >= 10
        ) {
          a.status = "failed";
          if (
            (await this.commit({
              now,
              checks: [[key, raw]],
              writes: [this.write(key, c)],
              rates: [],
              alert: { id, score: null },
            })) === 1
          )
            break;
          continue;
        }
        if (
          a.nextDue > now ||
          (a.status === "leased" && (a.deadline ?? 0) > now)
        )
          break;
        a.status = "leased";
        a.lease = randomUUID();
        a.deadline = deadline;
        a.attempts++;
        if (
          (await this.commit({
            now,
            checks: [[key, raw]],
            writes: [this.write(key, c)],
            rates: [],
            alert: { id, score: -deadline },
          })) === 1
        )
          return {
            id,
            humanReviewId: r.id,
            idempotencyKey: `website-redis-review-${r.id}`,
            attemptCount: a.attempts,
            leaseToken: a.lease,
            reason: r.reason,
            redactedSummary: `Website chat requires human review (${r.reason}).`,
            openedAt: new Date(a.openedAt),
            deepLinkExpiresAt: new Date(r.expiresAt),
          };
      }
    }
    return null;
  }
  private async mutateAlert(
    input: { id: string; leaseToken: string; now: Date },
    change: (a: Alert) => void,
  ) {
    const { value: locator } = await this.read<{ id: string }>(
      this.key("alert", input.id),
    );
    if (!locator) return false;
    const key = this.key("conversation", locator.id),
      now = input.now.getTime();
    for (let i = 0; i < 12; i++) {
      const { raw, value: c } = await this.read<Conversation>(key),
        r = c?.review,
        a = r?.alert;
      if (
        !c ||
        !r ||
        r.id !== input.id ||
        r.resolvedText ||
        !a ||
        a.status !== "leased" ||
        a.lease !== input.leaseToken ||
        (a.deadline ?? 0) <= now
      )
        return false;
      change(a);
      const deadline = a.deadline;
      const committed = await this.commit({
        now,
        deadline,
        checks: [[key, raw]],
        writes: [this.write(key, c)],
        rates: [],
        alert: {
          id: r.id,
          score: ["sent", "failed"].includes(a.status) ? null : -a.nextDue,
        },
      });
      if (committed === -2) return false;
      if (committed === 1) return true;
    }
    throw Error("website_redis_conflict_retry_required");
  }
  async confirmClaimedReviewAlert(
    input: Parameters<
      WebsiteReviewAlertRepository["confirmClaimedReviewAlert"]
    >[0],
  ) {
    return this.mutateAlert(input, () => {});
  }
  async beginClaimedReviewAlertSend(
    input: Parameters<
      WebsiteReviewAlertRepository["beginClaimedReviewAlertSend"]
    >[0],
  ): ReturnType<WebsiteReviewAlertRepository["beginClaimedReviewAlertSend"]> {
    if (!HASH.test(input.payloadDigest))
      throw Error("website_alert_payload_invalid");
    let mismatch = false;
    const valid = await this.mutateAlert(input, (a) => {
      mismatch = Boolean(
        a.payloadDigest && a.payloadDigest !== input.payloadDigest,
      );
      if (mismatch) a.status = "failed";
      else a.payloadDigest = input.payloadDigest;
    });
    return !valid ? "resolved" : mismatch ? "payload_mismatch" : "send";
  }
  async markReviewAlertSent(
    input: Parameters<WebsiteReviewAlertRepository["markReviewAlertSent"]>[0],
  ) {
    return this.mutateAlert(input, (a) => {
      a.status = "sent";
      a.providerMessageId = input.providerMessageId;
    });
  }
  async markReviewAlertUncertain(
    input: Parameters<
      WebsiteReviewAlertRepository["markReviewAlertUncertain"]
    >[0],
  ) {
    return this.mutateAlert(input, (a) => {
      a.status = "failed";
    });
  }
  async retryReviewAlert(
    input: Parameters<WebsiteReviewAlertRepository["retryReviewAlert"]>[0],
  ): ReturnType<WebsiteReviewAlertRepository["retryReviewAlert"]> {
    const valid = await this.mutateAlert(input, (a) => {
      a.status = "retry_wait";
      a.nextDue = input.nextAttemptAt.getTime();
    });
    return valid ? "retry_wait" : "resolved";
  }
  async readWebsiteTakeover(inboxId: string) {
    const { value: c } = await this.read<Conversation>(
      this.key("conversation", inboxId),
    );
    return c ? { active: c.takeover } : null;
  }
  async pendingTurnIds(limit = 10) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw Error("website_recovery_limit_invalid");
    const ids = await this.redis.zrange(
      `${this.namespace}:pending`,
      0,
      limit - 1,
    );
    const turns = await Promise.all(
      ids.map((id) => this.recoverableTurnIds(id)),
    );
    return turns.flat();
  }
  async recoverableTurnIds(conversationId: string) {
    const key = this.key("conversation", conversationId);
    const { raw, value: c } = await this.read<Conversation>(key);
    const t = c?.turns.find((turn) => turn.id === c.latestTurnId);
    if (!t || !["pending", "leased"].includes(t.status)) {
      await this.commit({
        now: this.now(),
        checks: [[key, raw]],
        writes: [],
        rates: [],
        pending: { id: conversationId, score: null },
      });
      return [];
    }
    return t.status === "pending" || (t.deadline ?? 0) <= this.now()
      ? [t.id]
      : [];
  }
}
