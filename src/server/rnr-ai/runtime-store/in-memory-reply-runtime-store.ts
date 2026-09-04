import { randomUUID } from "node:crypto";
import type { AiControlConfig } from "../control/types";
import type {
  AiControlSnapshot,
  BacklogLease,
  BacklogResult,
  DeliveryLease,
  DeliveryResult,
  DeliveryState,
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
  providerSendStartedAt?: string | null;
  result: Result | null;
};

type BacklogRecord = {
  controlRevision: number;
  window: TimeWindow;
  leaseToken: string | null;
  expiresAtMs: number;
  result: BacklogResult | null;
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
  private readonly senderEchoes = new Map<string, number>();
  private readonly takeovers = new Map<string, TakeoverState>();
  private readonly backlogs = new Map<string, BacklogRecord>();
  private readonly reviews = new Map<string, { ciphertext: string; metadata: ReviewMetadata; expiresAtMs: number }>();
  private readonly ephemeralSecrets = new Map<string, { ciphertext: string; expiresAtMs: number }>();
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
    if (current?.result || current?.providerSendStartedAt || (current && current.expiresAtMs > this.now())) return null;
    const leaseToken = randomUUID();
    const expiresAtMs = this.now() + leaseMs;
    map.set(key, { leaseToken, expiresAtMs, providerSendStartedAt: null, result: null });
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

  async readDelivery(key: string): Promise<DeliveryState | null> {
    requireHash(key, "runtime key");
    const current = this.deliveries.get(key);
    return current ? { providerSendStartedAt: current.providerSendStartedAt ?? null, result: current.result } : null;
  }

  async beginDeliverySend(lease: DeliveryLease, startedAt: string) {
    const current = this.deliveries.get(lease.key);
    if (!current || current.leaseToken !== lease.leaseToken || current.expiresAtMs <= this.now() || current.result) {
      throw new Error("Delivery lease is no longer valid");
    }
    current.providerSendStartedAt = new Date(startedAt).toISOString();
  }

  async releaseDelivery(lease: DeliveryLease) {
    const current = this.deliveries.get(lease.key);
    if (!current || current.leaseToken !== lease.leaseToken || current.expiresAtMs <= this.now() || current.result) {
      throw new Error("Delivery lease is no longer valid");
    }
    this.deliveries.delete(lease.key);
  }

  async settleDelivery(lease: DeliveryLease, result: DeliveryResult) {
    const current = this.deliveries.get(lease.key);
    if (!current || current.leaseToken !== lease.leaseToken || current.expiresAtMs <= this.now() || current.result) {
      throw new Error("Delivery lease is no longer valid");
    }
    current.result = Object.freeze({ ...result });
  }

  async rememberSenderEcho(providerMessageKeyHash: string, ttlSeconds: number) {
    requireHash(providerMessageKeyHash, "provider message key");
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 30 * 24 * 60 * 60) {
      throw new Error("Sender echo TTL is invalid");
    }
    this.senderEchoes.set(providerMessageKeyHash, this.now() + ttlSeconds * 1_000);
  }

  async hasSenderEcho(providerMessageKeyHash: string) {
    requireHash(providerMessageKeyHash, "provider message key");
    const expiresAt = this.senderEchoes.get(providerMessageKeyHash);
    if (!expiresAt || expiresAt <= this.now()) {
      this.senderEchoes.delete(providerMessageKeyHash);
      return false;
    }
    return true;
  }

  async enqueueBacklog(controlRevision: number, window: TimeWindow) {
    const key = `${controlRevision}:${window.from}:${window.to}:${window.maxConversations}`;
    if (this.backlogs.has(key)) return false;
    this.backlogs.set(key, {
      controlRevision,
      window: Object.freeze({ ...window }),
      leaseToken: null,
      expiresAtMs: 0,
      result: null,
    });
    return true;
  }

  async claimBacklog(leaseMs: number): Promise<BacklogLease | null> {
    requireLeaseMs(leaseMs);
    for (const [key, backlog] of this.backlogs) {
      if (backlog.result || (backlog.leaseToken && backlog.expiresAtMs > this.now())) continue;
      backlog.leaseToken = randomUUID();
      backlog.expiresAtMs = this.now() + leaseMs;
      return Object.freeze({
        key,
        controlRevision: backlog.controlRevision,
        window: backlog.window,
        leaseToken: backlog.leaseToken,
        expiresAt: new Date(backlog.expiresAtMs).toISOString(),
      });
    }
    return null;
  }

  async settleBacklog(lease: BacklogLease, result: BacklogResult) {
    const current = this.backlogs.get(lease.key);
    if (!current || current.leaseToken !== lease.leaseToken || current.expiresAtMs <= this.now()) {
      throw new Error("Backlog lease is no longer valid");
    }
    current.result = Object.freeze({ ...result });
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

  async putEphemeralSecret(keyHash: string, ciphertext: string, ttlSeconds: number) {
    requireHash(keyHash, "ephemeral key");
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 900) {
      throw new Error("Ephemeral secret TTL must not exceed 15 minutes");
    }
    this.ephemeralSecrets.set(keyHash, { ciphertext, expiresAtMs: this.now() + ttlSeconds * 1_000 });
  }

  async readEphemeralSecret(keyHash: string) {
    requireHash(keyHash, "ephemeral key");
    const entry = this.ephemeralSecrets.get(keyHash);
    if (!entry || entry.expiresAtMs <= this.now()) {
      this.ephemeralSecrets.delete(keyHash);
      return null;
    }
    return entry.ciphertext;
  }

  async deleteEphemeralSecret(keyHash: string) {
    requireHash(keyHash, "ephemeral key");
    this.ephemeralSecrets.delete(keyHash);
  }

  exportStateForTest() {
    this.deleteExpiredReviews();
    return {
      control: this.control,
      events: [...this.events.entries()],
      deliveries: [...this.deliveries.entries()],
      senderEchoes: [...this.senderEchoes.keys()],
      takeovers: [...this.takeovers.entries()],
      backlogs: [...this.backlogs],
      reviews: [...this.reviews.entries()].map(([key, review]) => [key, review.metadata]),
      ephemeralSecrets: [...this.ephemeralSecrets.keys()],
    };
  }
}
