import { RedisReplyRuntimeStore } from "../runtime-store/redis-reply-runtime-store";
import { createWebsiteAiControlGate } from "./website-runtime";
import { Redis } from "@upstash/redis";
import { randomUUID, createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { RedisWebsiteRepository } from "./redis-website-repository";
import { fixture } from "./website-test-helper";
// Opt-in, loopback-only synthetic Redis. Never discovers or reads real credentials.
const url = process.env.WEBSITE_TEST_REDIS_URL;
describe.runIf(Boolean(url))("real Redis website Lua", () => {
  function setup() {
    if (!url || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url))
      throw Error("isolated loopback Redis required");
    const redis = new Redis({
      url,
      token: "synthetic-local-redis-test",
      automaticDeserialization: false,
      responseEncoding: false,
    });
    const repository = new RedisWebsiteRepository({
      namespace: `test-website-${randomUUID()}`,
      secret: "t".repeat(32),
      redis: {
        get: (key) => redis.get<string>(key),
        eval: (s, k, a) => redis.eval<string[], number>(s, k, a),
        zrange: (k, s, e) => redis.zrange<string[]>(k, s, e, { rev: true }),
      },
    });
    return { repository, redis, event: fixture().event };
  }
  it("dedupes concurrent writers, persists encrypted values and publishes with server-time lease", async () => {
    const { repository, event, redis } = setup();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        repository.ingestConversationEvent(event()),
      ),
    );
    expect(results.filter((r) => r.status === "turn_pending")).toHaveLength(1);
    expect(results.filter((r) => r.status === "duplicate")).toHaveLength(7);
    const turn = results.find((r) => r.status === "turn_pending")!;
    if (turn.status !== "turn_pending") throw Error();
    const lease = await repository.claimTurn(turn.turnId);
    expect(lease).not.toBeNull();
    expect(
      await repository.settleTurn(lease!, {
        risk: "GREEN",
        intent: "sizes",
        replyText: "A4 is available.",
        claims: [],
        toolEvidence: [],
        reasons: [],
        nextAction: "AUTO_REPLY_ELIGIBLE",
      }),
    ).toBe("published");
    const item = (await repository.listQueue(5)).items[0];
    expect(item.timeline).toHaveLength(2);
    const updates = await repository.listWebsitePublicUpdates({
      conversationId: item.inboxId,
      after: null,
      limit: 10,
    });
    expect(updates[0].orderingKey).toMatch(/\.\d{6}Z$/);
    expect(updates[1].orderingKey > updates[0].orderingKey).toBe(true);
    const keys = await redis.keys("test-website-*:website:v1:conversation:*");
    for (const key of keys)
      expect(await redis.get(key)).not.toContain("A4 is available");
  });
  it("charges session limit atomically across parallel distinct messages", async () => {
    const { repository, event } = setup();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        repository.ingestConversationEvent(event(String(i))),
      ),
    );
    expect(results.filter((r) => r.status === "turn_pending")).toHaveLength(5);
    expect(results.filter((r) => r.status === "rate_limited")).toHaveLength(3);
    const item = (await repository.listQueue(5)).items[0];
    expect(item.timeline).toHaveLength(5);
  });
  it("human takeover and newer message win publication CAS", async () => {
    const { repository, event } = setup();
    const result = await repository.ingestConversationEvent(event());
    if (result.status !== "turn_pending") throw Error();
    const lease = await repository.claimTurn(result.turnId);
    await repository.setWebsiteTakeover(lease!.conversationId, true);
    expect(
      await repository.settleTurn(lease!, {
        risk: "GREEN",
        intent: "size",
        replyText: "Draft only",
        claims: [],
        toolEvidence: [],
        reasons: [],
        nextAction: "AUTO_REPLY_ELIGIBLE",
      }),
    ).toBe("review");
    const item = (await repository.listQueue(5)).items[0];
    expect(item.timeline).toHaveLength(1);
    const input = {
      reviewSelector: item.websiteReview!.selector!,
      text: "Staff answer",
      actorUserId: "synthetic",
      now: new Date(),
    };
    expect(
      await Promise.all([
        repository.answerWebsiteReview(input),
        repository.answerWebsiteReview(input),
      ]),
    ).toEqual(
      expect.arrayContaining([{ status: "sent" }, { status: "duplicate" }]),
    );
  });
  it("enforces a shared network-minute bucket across sessions", async () => {
    const { repository, event } = setup();
    const hash = (s: string) => createHash("sha256").update(s).digest("hex");
    for (let i = 0; i < 11; i++) {
      const base = event(String(i));
      const result = await repository.ingestConversationEvent({
        ...base,
        channel: "website",
        role: "customer",
        identity: { kind: "website_conversation", keyHash: hash(`id${i}`) },
        externalConversationKeyHash: hash(`c${i}`),
        websiteRateLimit: {
          ...base.websiteRateLimit!,
          sessionKeyHash: hash(`s${i}`),
        },
      });
      expect(result.status).toBe(i < 10 ? "turn_pending" : "rate_limited");
    }
  });
  it("leases a Redis review alert and suppresses retries after durable sent state", async () => {
    const { repository, event } = setup();
    const result = await repository.ingestConversationEvent(event());
    if (result.status !== "turn_pending") throw Error();
    const lease = await repository.claimTurn(result.turnId);
    await repository.settleTurn(lease!, null);
    const now = new Date(),
      alert = await repository.claimDueReviewAlert({
        now,
        leaseExpiresAt: new Date(now.getTime() + 300000),
      });
    expect(alert).not.toBeNull();
    expect(
      await repository.beginClaimedReviewAlertSend({
        id: alert!.id,
        leaseToken: alert!.leaseToken,
        payloadDigest: "c".repeat(64),
        now,
      }),
    ).toBe("send");
    expect(
      await repository.markReviewAlertSent({
        id: alert!.id,
        leaseToken: alert!.leaseToken,
        providerMessageId: "synthetic-provider-id",
        now,
      }),
    ).toBe(true);
    expect(
      await repository.claimDueReviewAlert({
        now,
        leaseExpiresAt: new Date(now.getTime() + 300000),
      }),
    ).toBeNull();
  });
  it("reserves spend atomically across concurrent independent turn leases", async () => {
    const { repository, event } = setup();
    const leases = [];
    for (let i = 0; i < 2; i++) {
      const base = event(`budget${i}`),
        hash = (s: string) => createHash("sha256").update(s).digest("hex");
      const result = await repository.ingestConversationEvent({
        ...base,
        channel: "website",
        role: "customer",
        identity: {
          kind: "website_conversation",
          keyHash: hash(`budgetid${i}`),
        },
        externalConversationKeyHash: hash(`budgetconv${i}`),
        websiteRateLimit: {
          ...base.websiteRateLimit!,
          sessionKeyHash: hash(`budgetsession${i}`),
        },
      });
      if (result.status !== "turn_pending") throw Error();
      leases.push((await repository.claimTurn(result.turnId))!);
    }
    const results = await Promise.all(
      leases.map((lease) =>
        repository.reserveProviderBudget(lease, {
          dailyHardStopMicrousd: 1000,
          totalHardStopMicrousd: 1000,
        }),
      ),
    );
    expect(results.sort()).toEqual([false, true]);
  });
  it("atomically reconciles one HTTP reservation once under concurrent settlement", async () => {
    const { repository, event } = setup();
    const turn = await repository.ingestConversationEvent(event());
    if (turn.status !== "turn_pending") throw Error();
    const lease = (await repository.claimTurn(turn.turnId))!;
    const limits = { dailyHardStopMicrousd: 3000, totalHardStopMicrousd: 3000 };
    expect(
      await repository.reserveProviderBudget(
        lease,
        limits,
        2500,
        "reserved-call",
      ),
    ).toBe(true);
    await Promise.all([
      repository.settleProviderCallBudget(lease, "reserved-call", 500),
      repository.settleProviderCallBudget(lease, "reserved-call", 500),
    ]);
    expect(
      await repository.reserveProviderBudget(lease, limits, 2500, "next-call"),
    ).toBe(true);
    expect(
      await repository.reserveProviderBudget(lease, limits, 1, "overflow-call"),
    ).toBe(false);
  });
  it("reads the same Redis AI Control source used by Meta", async () => {
    if (!url || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url))
      throw Error("isolated Redis required");
    const namespace = `test-website-control-${randomUUID()}`,
      redis = new Redis({
        url,
        token: "synthetic-local-redis-test",
        responseEncoding: false,
      });
    const store = new RedisReplyRuntimeStore({ namespace, redis });
    const gate = createWebsiteAiControlGate({
      store,
      env: {
        RNR_AI_MASTER_ENABLED: "true",
        RNR_WEBSITE_SHARED_BRAIN_ENABLED: "true",
      },
      websiteEnabled: true,
    });
    expect(await gate()).toBe(false);
    await redis.set(`${namespace}:control`, {
      revision: 1,
      mode: "ON",
      timezone: "Pacific/Auckland",
      periods: [],
      override: null,
    });
    expect(await gate()).toBe(true);
    await redis.set(`${namespace}:control`, {
      revision: 2,
      mode: "OFF",
      timezone: "Pacific/Auckland",
      periods: [],
      override: null,
    });
    expect(await gate()).toBe(false);
  });
});
