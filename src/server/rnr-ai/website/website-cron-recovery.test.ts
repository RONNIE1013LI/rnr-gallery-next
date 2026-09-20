import { describe, expect, it, vi } from "vitest";
import { createWebsiteReplyRuntime } from "./website-runtime";
import { fixture } from "./website-test-helper";
import { createReviewAlertService } from "@/server/customer-service/website/review-alert-service";

describe("shared website Cron recovery with Redis transport fixture", () => {
  it("recovers a pending turn once and does no provider work on an empty queue", async () => {
    const f = fixture();
    const generate = vi.fn(async () => ({ decision: {
      risk: "GREEN" as const, intent: "sizes", replyText: "We offer A4 sizes.",
      reasons: [], claims: [], toolEvidence: [], nextAction: "AUTO_REPLY_ELIGIBLE" as const,
    } }));
    const runtime = createWebsiteReplyRuntime({ repository: f.repository, brain: { generate } });
    expect(await runtime.recoverDueTurns(1)).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
    await f.repository.ingestConversationEvent(f.event());
    expect(await runtime.recoverDueTurns(1)).toEqual([{ status: "published" }]);
    expect(await runtime.recoverDueTurns(1)).toEqual([]);
    expect(generate).toHaveBeenCalledOnce();
    expect((await f.repository.listQueue(5)).items[0].timeline.at(-1)?.role).toBe("assistant");
  });

  it("honours the deadline before generating a recoverable turn", async () => {
    const f = fixture(), generate = vi.fn();
    await f.repository.ingestConversationEvent(f.event());
    const runtime = createWebsiteReplyRuntime({ repository: f.repository, brain: { generate } });
    expect(await runtime.recoverDueTurns(1, Date.now())).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
    expect(await f.repository.pendingTurnIds()).toHaveLength(1);
  });

  it("sends actual review work once and never sends for empty Redis scans", async () => {
    const f = fixture(), send = vi.fn(async () => ({ providerMessageId: "synthetic-id" }));
    const reviewAlerts = createReviewAlertService({
      repository: f.repository, provider: { configured: true, send },
      alertTo: "staff@example.test", providerFrom: "RNR <mail@example.test>",
      siteUrl: "https://example.test", deepLinkSecret: "s".repeat(32),
      providerScopeFingerprint: "a".repeat(64), now: () => new Date(f.now()),
    });
    const runtime = createWebsiteReplyRuntime({
      repository: f.repository, brain: { generate: vi.fn() }, reviewAlerts,
    });
    expect(await runtime.recoverReviewAlerts(5)).toEqual(Array(5).fill({ result: "empty" }));
    expect(send).not.toHaveBeenCalled();
    const turn = await f.repository.ingestConversationEvent(f.event());
    if (turn.status !== "turn_pending") throw Error("Expected pending fixture");
    const lease = await f.repository.claimTurn(turn.turnId);
    await f.repository.settleTurn(lease!, null);
    expect(await runtime.recoverReviewAlerts(5, Date.now())).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect((await runtime.recoverReviewAlerts(5))[0]).toEqual({ result: "sent" });
    await runtime.recoverReviewAlerts(5);
    expect(send).toHaveBeenCalledOnce();
  });
});
