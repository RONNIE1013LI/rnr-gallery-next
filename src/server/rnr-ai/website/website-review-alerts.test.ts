import { describe, it, expect, vi } from "vitest";
import { fixture } from "./website-test-helper";
import {
  createReviewAlertService,
  createReviewAlertToken,
  hashReviewAlertToken,
} from "@/server/customer-service/website/review-alert-service";
async function setup() {
  const f = fixture(),
    result = await f.repository.ingestConversationEvent(f.event());
  if (result.status !== "turn_pending") throw Error();
  const lease = await f.repository.claimTurn(result.turnId);
  await f.repository.settleTurn(lease!, null);
  return f;
}
describe("Redis website review email recovery", () => {
  it("leases and sends once using existing idempotent alert service and resolves safe deeplink", async () => {
    const f = await setup(),
      send = vi.fn(async () => ({ providerMessageId: "synthetic-id" }));
    const service = createReviewAlertService({
      repository: f.repository,
      provider: { configured: true, send },
      alertTo: "staff@example.test",
      providerFrom: "RNR <mail@example.test>",
      siteUrl: "https://example.test",
      deepLinkSecret: "s".repeat(32),
      providerScopeFingerprint: "a".repeat(64),
      now: () => new Date(f.now()),
    });
    expect(await service.deliverNext()).toEqual({ result: "sent" });
    expect(await service.deliverNext()).toEqual({ result: "empty" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      (await f.repository.listQueue(5)).items[0].websiteReview?.alertStatus,
    ).toBe("sent");
  });
  it("human resolution before send invalidates alert lease", async () => {
    const f = await setup();
    const alert = await f.repository.claimDueReviewAlert({
      now: new Date(f.now()),
      leaseExpiresAt: new Date(f.now() + 300000),
    });
    expect(alert).not.toBeNull();
    const item = (await f.repository.listQueue(5)).items[0];
    await f.repository.answerWebsiteReview({
      reviewSelector: item.websiteReview!.selector!,
      text: "Handled",
      actorUserId: "admin",
      now: new Date(f.now()),
    });
    expect(
      await f.repository.beginClaimedReviewAlertSend({
        id: alert!.id,
        leaseToken: alert!.leaseToken,
        payloadDigest: "b".repeat(64),
        now: new Date(f.now()),
      }),
    ).toBe("resolved");
  });
  it("validates safe deeplinks and excludes resolved reviews", async () => {
    const f = await setup(),
      alert = await f.repository.claimDueReviewAlert({
        now: new Date(f.now()),
        leaseExpiresAt: new Date(f.now() + 300000),
      });
    const token = createReviewAlertToken({
      reviewId: alert!.humanReviewId,
      secret: "s".repeat(32),
    });
    const resolved = await f.repository.resolveWebsiteReviewDeepLink({
      tokenHash: hashReviewAlertToken(token),
      now: new Date(f.now()),
    });
    expect(resolved?.selector).toMatch(/^wrs1\./);
  });
});
