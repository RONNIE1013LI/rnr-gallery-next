import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { fixture } from "./website-test-helper";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
describe("encrypted Redis website repository", () => {
  it("atomically deduplicates concurrent ingestion and encrypts transcript", async () => {
    const f = fixture();
    const results = await Promise.all([
      f.repository.ingestConversationEvent(f.event()),
      f.repository.ingestConversationEvent(f.event()),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([
      "duplicate",
      "turn_pending",
    ]);
    const queue = await f.repository.listQueue(10);
    expect(queue.items[0].timeline).toHaveLength(1);
    expect([...f.redis.values.values()].join()).not.toContain("What sizes");
  });
  it("fails identity mismatch without consuming rates", async () => {
    const f = fixture();
    await f.repository.ingestConversationEvent(f.event());
    await expect(
      f.repository.ingestConversationEvent(
        f.event("next", {
          identity: { kind: "website_conversation", keyHash: hash("other") },
        }),
      ),
    ).rejects.toThrow("identity_mismatch");
  });
  it("enforces five messages per minute and does not charge duplicates", async () => {
    const f = fixture();
    for (let i = 0; i < 5; i++)
      expect(
        (await f.repository.ingestConversationEvent(f.event(String(i)))).status,
      ).toBe("turn_pending");
    expect(
      (await f.repository.ingestConversationEvent(f.event("0"))).status,
    ).toBe("duplicate");
    expect(
      (await f.repository.ingestConversationEvent(f.event("6"))).status,
    ).toBe("rate_limited");
    f.advance(60001);
    expect(
      (await f.repository.ingestConversationEvent(f.event("6"))).status,
    ).toBe("turn_pending");
  });
  it("rejects publication of an older customer turn and expired lease", async () => {
    const f = fixture();
    const first = await f.repository.ingestConversationEvent(f.event());
    if (first.status !== "turn_pending") throw Error();
    const lease = await f.repository.claimTurn(first.turnId);
    expect(lease).not.toBeNull();
    await f.repository.ingestConversationEvent(f.event("new"));
    expect(
      await f.repository.settleTurn(lease!, {
        risk: "GREEN",
        intent: "sizes",
        replyText: "Available in A4.",
        reasons: [],
        claims: [],
        toolEvidence: [],
        nextAction: "AUTO_REPLY_ELIGIBLE",
      }),
    ).toBe("cancelled");
    expect((await f.repository.listQueue(10)).items[0].timeline).toHaveLength(
      2,
    );
  });
  it("manual review reply wins against late AI and duplicate human submission", async () => {
    const f = fixture();
    const first = await f.repository.ingestConversationEvent(f.event());
    if (first.status !== "turn_pending") throw Error();
    const lease = await f.repository.claimTurn(first.turnId);
    await f.repository.settleTurn(lease!, null);
    const item = (await f.repository.listQueue(10)).items[0];
    const selector = item.websiteReview!.selector!;
    const input = {
      reviewSelector: selector,
      text: "I can help.",
      actorUserId: "admin",
      now: new Date(f.now()),
    };
    expect(await f.repository.answerWebsiteReview(input)).toEqual({
      status: "sent",
    });
    expect(await f.repository.answerWebsiteReview(input)).toEqual({
      status: "duplicate",
    });
    expect(
      (await f.repository.listQueue(10)).items[0].timeline.at(-1)?.role,
    ).toBe("staff");
  });
});

describe("website Redis spend admission", () => {
  it("reserves once per lease and blocks subsequent reservations at daily cap", async () => {
    const f = fixture();
    const first = await f.repository.ingestConversationEvent(f.event());
    if (first.status !== "turn_pending") throw Error();
    const lease = await f.repository.claimTurn(first.turnId);
    const budget = { dailyHardStopMicrousd: 1000, totalHardStopMicrousd: 2000 };
    expect(await f.repository.reserveProviderBudget(lease!, budget)).toBe(true);
    expect(await f.repository.reserveProviderBudget(lease!, budget)).toBe(true);
    const second = await f.repository.ingestConversationEvent(f.event("new"));
    if (second.status !== "turn_pending") throw Error();
    const next = await f.repository.claimTurn(second.turnId);
    expect(await f.repository.reserveProviderBudget(next!, budget)).toBe(false);
  });
});

describe("website recovery and expiry", () => {
  it("retires expired-session pending work without a paid retry", async () => {
    const f = fixture();
    const result = await f.repository.ingestConversationEvent(
      f.event("expiring", {
        websiteRateLimit: {
          sessionKeyHash: hash("session"),
          networkKeyHash: hash("network"),
          sessionExpiresAt: new Date(f.now() + 1000),
        },
      }),
    );
    if (result.status !== "turn_pending") throw Error();
    f.advance(1001);
    expect(await f.repository.claimTurn(result.turnId)).toBeNull();
    expect(await f.repository.pendingTurnIds()).toEqual([]);
  });
  it("suppresses a validated no-reply decision without inventing a review", async () => {
    const f = fixture();
    const result = await f.repository.ingestConversationEvent(f.event());
    if (result.status !== "turn_pending") throw Error();
    const lease = await f.repository.claimTurn(result.turnId);
    expect(
      await f.repository.settleTurn(lease!, {
        risk: "GREEN",
        intent: "ack",
        replyText: null,
        reasons: [],
        claims: [],
        toolEvidence: [],
        nextAction: "NO_REPLY",
      }),
    ).toBe("cancelled");
    expect((await f.repository.listQueue(5)).items[0].websiteReview).toBeNull();
  });
});

describe("website maximum transcript retention", () => {
  it("expires an active epoch at30days and allows clean renewed-session ingestion", async () => {
    const f = fixture();
    await f.repository.ingestConversationEvent(f.event());
    const first = (await f.repository.listQueue(5)).items[0];
    f.advance(29 * 86400000);
    const newSession = {
      sessionKeyHash: hash("renewed-session"),
      networkKeyHash: hash("renewed-network"),
      sessionExpiresAt: new Date(f.now() + 604800000),
    };
    const result = await f.repository.ingestConversationEvent(
      f.event("late-message", {
        externalConversationKeyHash: hash("new-tech"),
        websiteRateLimit: newSession,
      }),
    );
    if (result.status !== "turn_pending") throw Error();
    const lease = await f.repository.claimTurn(result.turnId);
    f.advance(86400001);
    expect(
      await f.repository.resolveWebsiteSession({
        sessionTokenHash: newSession.sessionKeyHash,
        now: new Date(f.now()),
      }),
    ).toBeNull();
    expect(await f.repository.settleTurn(lease!, null)).toBe("cancelled");
    expect(
      await f.repository.listWebsitePublicUpdates({
        conversationId: first.inboxId,
        after: null,
        limit: 10,
      }),
    ).toEqual([]);
    expect(
      (
        await f.repository.ingestConversationEvent(
          f.event("renewed-message", {
            externalConversationKeyHash: hash("epoch-tech"),
            websiteRateLimit: {
              ...newSession,
              sessionKeyHash: hash("epoch-session"),
              sessionExpiresAt: new Date(f.now() + 604800000),
            },
          }),
        )
      ).status,
    ).toBe("turn_pending");
    expect((await f.repository.listQueue(5)).items[0].timeline).toHaveLength(1);
  });
});

describe("remaining website rate windows", () => {
  it("enforces30 per session hour", async () => {
    const f = fixture();
    for (let batch = 0; batch < 6; batch++) {
      for (let i = 0; i < 5; i++)
        expect(
          (
            await f.repository.ingestConversationEvent(
              f.event(`h${batch}-${i}`),
            )
          ).status,
        ).toBe("turn_pending");
      f.advance(60001);
    }
    expect(
      (await f.repository.ingestConversationEvent(f.event("blocked-hour")))
        .status,
    ).toBe("rate_limited");
  });
  it("enforces100 total per session across hour resets", async () => {
    const f = fixture();
    let count = 0;
    for (let hour = 0; hour < 4; hour++) {
      for (let batch = 0; batch < 6; batch++) {
        for (let i = 0; i < 5; i++) {
          const result = await f.repository.ingestConversationEvent(
            f.event(`t${count}`),
          );
          expect(result.status).toBe(
            count < 100 ? "turn_pending" : "rate_limited",
          );
          count++;
        }
        f.advance(60001);
      }
      f.advance(3600001);
    }
  });
  it("enforces60 per network hour across distinct sessions", async () => {
    const f = fixture();
    for (let batch = 0; batch < 7; batch++) {
      for (let i = 0; i < 10; i++) {
        const n = batch * 10 + i;
        const base = f.event(`network${n}`);
        const result = await f.repository.ingestConversationEvent({
          ...base,
          channel: "website",
          role: "customer",
          identity: {
            kind: "website_conversation",
            keyHash: hash(`identity${n}`),
          },
          externalConversationKeyHash: hash(`conversation${n}`),
          websiteRateLimit: {
            ...base.websiteRateLimit!,
            sessionKeyHash: hash(`session${n}`),
          },
        });
        expect(result.status).toBe(n < 60 ? "turn_pending" : "rate_limited");
      }
      f.advance(60001);
    }
  });
});

describe("website Redis failure isolation", () => {
  it("fails closed during outage and accepts the exact message after recovery", async () => {
    const f = fixture(),
      original = f.redis.eval.bind(f.redis);
    f.redis.eval = async () => {
      throw Error("synthetic Redis outage");
    };
    await expect(
      f.repository.ingestConversationEvent(f.event()),
    ).rejects.toThrow("synthetic Redis outage");
    expect(f.redis.values.size).toBe(0);
    f.redis.eval = original;
    expect((await f.repository.ingestConversationEvent(f.event())).status).toBe(
      "turn_pending",
    );
    expect((await f.repository.ingestConversationEvent(f.event())).status).toBe(
      "duplicate",
    );
  });
});
