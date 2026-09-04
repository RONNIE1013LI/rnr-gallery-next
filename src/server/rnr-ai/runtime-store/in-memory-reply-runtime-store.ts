import { randomUUID } from "node:crypto";
import type { AiControlConfig } from "../control/types";
import type {
  AiControlSnapshot,
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

type LeaseRecord<Result> = {
  leaseToken: string;
  expiresAtMs: number;
  result: Result | null;
};

const initialControl: AiControlConfig = Object.freeze({
  revision: 0,
  mode: "OFF",
  timezone: "Pacific/Auckland",
  periods: Object.freeze([]),
  override: null,
});

function requireHash(value: string, label: string) {
  if (!HASH.test(value)) throw new Error(`${label} must be an HMAC hash`);
}

function requireLeaseMs(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 300_000) {
    throw new Error("leaseMs must be between 1 and 300000");
  }
}

export class InMemoryReplyRuntimeStore implements ReplyRuntimeStore {
  private control: AiControlConfig = initialControl;
  private readonly events = new Map<string, LeaseRecord<EventResult>>();
  private readonly deliveries = new Map<string, LeaseRecord<DeliveryResult>>();
  private readonly takeovers = new Map<string, TakeoverState>();
  private readonly backlogs = new Set<string>();
  private readonly reviews = new Map<string, { ciphertext: string; metadata: ReviewMetadata; expiresAtMs: number }>();
  private readonly now: () => number;

  constructor({ now = Date.now }: Readonly<{ now?: () => number }> = {}) {
    this.now = now;
  }

  async readControl(): Promise<AiControlSnapshot> {
    return { config: this.control, readAt: new Date(this.now()).toISOString() };
  }

  async compareAndSetControl(expectedRevision: number, next: AiControlConfig) {
    if (this.control.revision !== expectedRevision || next.revision !== expectedRevision + 1) return false;
    this.control = Object.freeze({ ...next, periods: Object.freeze([...next.periods]) });
    return true;
  }

  private claim<Result>(map: Map<string, LeaseRecord<Result>>, key: string, leaseMs: number) {
    requireHash(key, "runtime key");
    requireLeaseMs(leaseMs);
    const current = map.get(key);
    if (current?.result || (current && current.expiresAtMs > this.now())) return null;
    const leaseToken = randomUUID();
    const expiresAtMs = this.now() + leaseMs;
    map.set(key, { leaseToken, expiresAtMs, result: null });
    return { leaseToken, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  async claimEvent(keyHash: string, leaseMs: number): Promise<EventLease | null> {
    const lease = this.claim(this.events, keyHash, leaseMs);
    return lease ? { keyHash, ...lease } : null;
  }

  async settleEvent(lease: EventLease, result: EventResult) {
    const current = this.events.get(lease.keyHash);
    if (!current || current.leaseToken !== lease.leaseToken || current.expiresAtMs <= this.now()) {
      throw new Error("Event lease is no longer valid");
    }
    current.result = Object.freeze({ ...result });
  }

  async readTakeover(conversationKeyHash: string) {
    requireHash(conversationKeyHash, "conversation key");
    return this.takeovers.get(conversationKeyHash) ?? null;
  }

  async setTakeover(input: TakeoverMutation) {
    requireHash(input.conversationKeyHash, "conversation key");
    this.takeovers.set(input.conversationKeyHash, Object.freeze({
      active: input.active,
      source: input.source,
      changedAt: new Date(input.changedAt).toISOString(),
    }));
  }

  async claimDelivery(key: string, leaseMs: number): Promise<DeliveryLease | null> {
    const lease = this.claim(this.deliveries, key, leaseMs);
    return lease ? { key, ...lease } : null;
  }

  async settleDelivery(lease: DeliveryLease, result: DeliveryResult) {
    const current = this.deliveries.get(lease.key);
    if (!current || current.leaseToken !== lease.leaseToken || current.expiresAtMs <= this.now()) {
      throw new Error("Delivery lease is no longer valid");
    }
    current.result = Object.freeze({ ...result });
  }

  async enqueueBacklog(controlRevision: number, window: TimeWindow) {
    const key = `${controlRevision}:${window.from}:${window.to}:${window.maxConversations}`;
    if (this.backlogs.has(key)) return false;
    this.backlogs.add(key);
    return true;
  }

  private deleteExpiredReviews() {
    for (const [key, review] of this.reviews) {
      if (review.expiresAtMs <= this.now()) this.reviews.delete(key);
    }
  }

  async putEncryptedReview(
    key: string,
    ciphertext: string,
    ttlSeconds: 172800 = 172_800,
    metadata?: ReviewMetadataInput,
  ) {
    requireHash(key, "review key");
    if (ttlSeconds !== 172_800) throw new Error("Review retention must be exactly 48 hours");
    if (!metadata) throw new Error("Review metadata is required");
    requireHash(metadata.conversationKeyHash, "conversation key");
    const expiresAtMs = this.now() + ttlSeconds * 1_000;
    this.reviews.set(key, {
      ciphertext,
      expiresAtMs,
      metadata: Object.freeze({
        key,
        ...metadata,
        createdAt: new Date(metadata.createdAt).toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(),
      }),
    });
  }

  async listReviewMetadata(limit: number) {
    this.deleteExpiredReviews();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid review limit");
    return [...this.reviews.values()]
      .map((review) => review.metadata)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async readEncryptedReview(key: string) {
    requireHash(key, "review key");
    this.deleteExpiredReviews();
    return this.reviews.get(key)?.ciphertext ?? null;
  }

  async deleteReview(key: string) {
    requireHash(key, "review key");
    this.reviews.delete(key);
  }

  exportStateForTest() {
    this.deleteExpiredReviews();
    return {
      control: this.control,
      events: [...this.events.entries()],
      deliveries: [...this.deliveries.entries()],
      takeovers: [...this.takeovers.entries()],
      backlogs: [...this.backlogs],
      reviews: [...this.reviews.entries()].map(([key, review]) => [key, review.metadata]),
    };
  }
}
