import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { Redis } from "@upstash/redis";
import type { SafeInboxItem, SafeTimelineEvent } from "@/server/customer-service/repositories/customer-service-repository";
import type { MetaConversationLocator, MetaContextProvider } from "../meta/context-provider";

const RETENTION = 30 * 86400;
export function metaInboxId(identityHash: string) {
  return createHash("sha256").update(`facebook\0facebook_psid\0${identityHash}`).digest("hex");
}

export class MetaInbox {
  constructor(private readonly dependencies: {
    redis: Redis; namespace: string; encryptionKey: string; idHashSecret: string;
    pageId: string; context: MetaContextProvider;
    discover: () => Promise<readonly MetaConversationLocator[]>;
  }) {}
  private key(suffix: string) { return `${this.dependencies.namespace}:inbox:meta:${suffix}`; }
  private seal(id: string, value: unknown) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(this.dependencies.encryptionKey).digest(), iv);
    cipher.setAAD(Buffer.from(id));
    const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return [iv, cipher.getAuthTag(), body].map(value => value.toString("base64url")).join(".");
  }
  private open<T>(id: string, value: string): T {
    const [iv, tag, body] = value.split(".").map(value => Buffer.from(value, "base64url"));
    const cipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(this.dependencies.encryptionKey).digest(), iv);
    cipher.setAAD(Buffer.from(id)); cipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([cipher.update(body), cipher.final()]).toString()) as T;
  }
  async index(externalConversationKey: string, receivedAt: Date) {
    const identityKeyHash = createHmac("sha256", this.dependencies.idHashSecret).update(externalConversationKey).digest("hex");
    const id = metaInboxId(identityKeyHash);
    const locator = { channel: "facebook" as const, externalConversationKey, pageId: this.dependencies.pageId, updatedAt: receivedAt.toISOString() };
    await this.dependencies.redis.eval(`
local score = redis.call('ZSCORE', KEYS[2], ARGV[1])
if score and tonumber(score) >= tonumber(ARGV[2]) then return 0 end
redis.call('SET', KEYS[1], ARGV[3], 'EX', ARGV[4])
redis.call('ZADD', KEYS[2], ARGV[2], ARGV[1])
redis.call('DEL', KEYS[3])
return 1`, [this.key(id), this.key("activity"), this.key(`cache:${id}`)],
      [id, receivedAt.getTime(), this.seal(id, { locator, identityKeyHash }), RETENTION]);
    await this.dependencies.redis.zremrangebyscore(this.key("activity"), 0, Date.now() - RETENTION * 1000);
  }
  async resolve(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) return null;
    const value = await this.dependencies.redis.get<string>(this.key(id));
    return value ? this.open<{ locator: MetaConversationLocator; identityKeyHash: string }>(id, value) : null;
  }
  async timeline(input: { inboxId: string; cursor: string; limit: number }) {
    const target = await this.resolve(input.inboxId);
    if (!target) throw new Error("reply_assistant_inbox_not_found");
    const snapshot = await this.dependencies.context.loadConversation(target.locator);
    const events: SafeTimelineEvent[] = snapshot.events.map(event => ({
      eventId: `meta:${createHmac("sha256", this.dependencies.idHashSecret).update(event.externalMessageKey).digest("hex")}`,
      role: event.role === "customer" ? "customer" : "staff", pageOutbound: event.role !== "customer",
      text: event.text ?? "[Attachment]", receivedAt: new Date(event.receivedAt).toISOString(),
    }));
    const end = input.cursor === `meta:${input.inboxId}` ? events.length : events.findIndex(event => event.eventId === input.cursor);
    if (end < 0) throw new Error("reply_assistant_timeline_cursor_invalid");
    const start = Math.max(0, end - Math.min(50, input.limit));
    const page = events.slice(start, end);
    return { events: page, cursor: page[0]?.eventId ?? null, hasEarlier: start > 0 };
  }
  async list(limit = 100): Promise<{ items: SafeInboxItem[] }> {
    // A Redis lease bounds discovery across server instances and dashboard polling.
    if (await this.dependencies.redis.set(this.key("discovery"), "1", { nx: true, ex: 300 })) {
      const locators = await this.dependencies.discover();
      for (const locator of locators) await this.index(locator.externalConversationKey, new Date(locator.updatedAt ?? 0));
    }
    const ids = await this.dependencies.redis.zrange<string[]>(this.key("activity"), 0, Math.min(limit, 100) - 1, { rev: true });
    const items: SafeInboxItem[] = [];
    const deadline = Date.now() + 15_000;
    // Five concurrent reads bound Graph fanout while keeping initial load usable.
    for (let offset = 0; offset < ids.length; offset += 5) {
      await Promise.all(ids.slice(offset, offset + 5).map(async (id) => {
      const target = await this.resolve(id);
      if (!target) return;
      const cached = await this.dependencies.redis.get<string>(this.key(`cache:${id}`));
      if (cached) { items.push(this.open<SafeInboxItem>(id, cached)); return; }
      const snapshot = Date.now() < deadline
        ? await this.dependencies.context.loadConversation(target.locator, { maxTurns: 50 })
        : { events: [], incompleteReason: "Preview pending; load history or refresh.", complete: false };
      const timeline = snapshot.events.map(event => ({
        eventId: `meta:${createHmac("sha256", this.dependencies.idHashSecret).update(event.externalMessageKey).digest("hex")}`,
        role: event.role === "customer" ? "customer" as const : "staff" as const,
        pageOutbound: event.role !== "customer",
        text: event.text ?? (event.attachments.length ? "[Attachment]" : "[Message]"),
        receivedAt: new Date(event.receivedAt).toISOString(),
      }));
      const last = timeline.at(-1);
      const item: SafeInboxItem = {
        inboxId: id, channel: "facebook", source: "shared_meta", latestMessageId: last?.eventId ?? id,
        lastActivityAt: last?.receivedAt ?? target.locator.updatedAt ?? new Date(0).toISOString(), unreadCount: 0,
        status: !last ? "history_pending" : last.role === "staff" ? "page_replied" : "awaiting_reply", latestAttemptId: null,
        draftText: null, gateResult: null, attachmentCount: snapshot.events.reduce((n, event) => n + event.attachments.length, 0),
        imageAnalysisStatus: "not_applicable", imageAssessmentSummary: null, humanReplyReceived: false,
        websiteReview: null, timeline, hasEarlierTimeline: !snapshot.complete,
        historyIncompleteReason: `${snapshot.incompleteReason ? `History incomplete: ${snapshot.incompleteReason}. ` : ""}Discovery covers the last 24 hours, up to 100 conversations / 5 Graph pages, refreshed every 5 minutes. Preview shows up to 50 messages and is cached up to 30 seconds; load earlier history for up to 500 messages / 60,000 characters / 6 Graph pages.`,
      };
      if (snapshot.events.length) await this.dependencies.redis.set(this.key(`cache:${id}`), this.seal(id, item), { ex: 30 });
      items.push(item);
      }));
    }
    return { items };
  }
}
