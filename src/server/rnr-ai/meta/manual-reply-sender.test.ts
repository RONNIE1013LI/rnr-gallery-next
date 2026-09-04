import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { InMemoryReplyRuntimeStore } from "../runtime-store/in-memory-reply-runtime-store";
import type { MetaConversationSnapshot } from "./types";
import type { MetaConversationLocator } from "./context-provider";
import { createManualFacebookReplySender, type ManualFacebookReplyTarget } from "./manual-reply-sender";
import { createMetaReplySender } from "./reply-sender";

const now = new Date("2026-09-04T04:00:00.000Z");
const psid = "facebook-customer-123";
const messageKey = "mid.customer.1";
const identityKeyHash = hash(psid);
const latestCustomerMessageKeyHash = hash(messageKey);
const item = Object.freeze({
  inboxId: "a".repeat(64), channel: "facebook" as const, latestMessageId: "11111111-1111-4111-8111-111111111111",
  lastActivityAt: now.toISOString(), unreadCount: 0, status: "draft_ready",
  latestAttemptId: "22222222-2222-4222-8222-222222222222", draftText: "Draft", gateResult: null,
  attachmentCount: 0, imageAnalysisStatus: "not_applicable" as const, imageAssessmentSummary: null,
  humanReplyReceived: true, websiteReview: null, hasEarlierTimeline: false,
  timeline: Object.freeze([{ eventId: "event:sent", role: "staff" as const, text: "Final edited reply", receivedAt: now.toISOString() }]),
});

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function setup(fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message_id: "mid.sent.1" }), { status: 200 }))) {
  const store = new InMemoryReplyRuntimeStore({ now: () => now.getTime() });
  const resolveTarget = vi.fn<(input: { inboxId: string; attemptId: string }) => Promise<ManualFacebookReplyTarget | null>>(async () => ({ identityKeyHash, latestCustomerMessageKeyHash }));
  const listConversations = vi.fn(async () => [{ channel: "facebook" as const, externalConversationKey: psid, pageId: "page-1" }]);
  const loadConversation = vi.fn<(locator: MetaConversationLocator) => Promise<MetaConversationSnapshot>>(async () => ({
    channel: "facebook" as const,
    complete: true,
    incompleteReason: null,
    characters: 8,
    turnsConsidered: 1,
    events: [{
      channel: "facebook" as const, role: "customer" as const, eventType: "customer_message" as const,
      externalConversationKey: psid, externalMessageKey: messageKey, externalReplyToMessageKey: null,
      text: "Customer", attachments: [], receivedAt: new Date("2026-09-04T03:59:00.000Z"),
    }],
  }));
  const recordSent = vi.fn(async () => item);
  const loadItem = vi.fn(async () => item);
  return {
    store, resolveTarget, listConversations, loadConversation, recordSent, loadItem, fetchImpl,
    sender: createManualFacebookReplySender({
      accessToken: "server-only-token", pageId: "page-1", store,
      resolveTarget, listConversations, loadConversation, recordSent, loadItem,
      hashExternalKey: hash, fetchImpl, now: () => now,
    }),
  };
}

const input = Object.freeze({
  inboxId: item.inboxId,
  attemptId: item.latestAttemptId!,
  text: "Final edited reply",
  idempotencyKey: "manual-click-1",
  actorUserId: "admin-1",
});

describe("manual Facebook reply sender", () => {
  it("sends the exact final text while autonomous controls are irrelevant and activates takeover", async () => {
    const current = setup();
    await expect(current.sender.send(input)).resolves.toMatchObject({ status: "sent", item });
    expect(current.fetchImpl).toHaveBeenCalledOnce();
    const [, init] = current.fetchImpl.mock.calls[0] as unknown as [unknown, RequestInit];
    expect(JSON.parse(String(init?.body))).toEqual({
      recipient: { id: psid }, messaging_type: "RESPONSE", message: { text: "Final edited reply" },
    });
    await expect(current.store.readTakeover(identityKeyHash)).resolves.toMatchObject({ active: true, source: "admin" });
    expect(current.recordSent).toHaveBeenCalledWith(expect.objectContaining({
      providerMessageId: "mid.sent.1", text: "Final edited reply", actorUserId: "admin-1",
    }));
  });

  it("resolves only the server-authorized hashed Facebook target and verifies the latest customer message", async () => {
    const current = setup();
    await current.sender.send(input);
    expect(current.resolveTarget).toHaveBeenCalledWith({ inboxId: input.inboxId, attemptId: input.attemptId });
    expect(current.listConversations).toHaveBeenCalledWith(expect.objectContaining({ maxConversations: 100 }));
    expect(current.loadConversation).toHaveBeenCalledWith({ channel: "facebook", externalConversationKey: psid, pageId: "page-1" });
  });

  it("does not send when the target cannot be resolved or the provider context is stale", async () => {
    const missing = setup();
    missing.resolveTarget.mockResolvedValueOnce(null);
    await expect(missing.sender.send(input)).resolves.toEqual({ status: "unavailable" });
    expect(missing.fetchImpl).not.toHaveBeenCalled();

    const stale = setup();
    stale.loadConversation.mockResolvedValueOnce({
      channel: "facebook", complete: true, incompleteReason: null, characters: 5, turnsConsidered: 1,
      events: [{ channel: "facebook", role: "staff", eventType: "human_outbound", externalConversationKey: psid,
        externalMessageKey: "mid.staff", externalReplyToMessageKey: null, text: "Already replied", attachments: [], receivedAt: now }],
    });
    await expect(stale.sender.send(input)).resolves.toEqual({ status: "unavailable" });
    expect(stale.fetchImpl).not.toHaveBeenCalled();
  });

  it("deduplicates a repeated click and never sends a second provider request", async () => {
    const current = setup();
    await expect(current.sender.send(input)).resolves.toMatchObject({ status: "sent", duplicate: false });
    await expect(current.sender.send(input)).resolves.toMatchObject({ status: "sent", duplicate: true });
    expect(current.fetchImpl).toHaveBeenCalledOnce();
  });

  it("shares the same customer-turn send fence with autonomous Meta delivery", async () => {
    const current = setup();
    await expect(current.sender.send(input)).resolves.toMatchObject({ status: "sent" });
    const autoFetch = vi.fn(async () => new Response(JSON.stringify({ message_id: "mid.auto" }), { status: 200 }));
    const auto = createMetaReplySender({
      config: { masterEnabled: true, engineMode: "shared_active", metaAutoSendEnabled: true, stageAAllowedRecipientHash: hash(psid) },
      accessToken: "server-only-token",
      pageId: "page-1",
      store: current.store,
      context: { loadConversation: current.loadConversation },
      takeover: { read: vi.fn(async () => ({ active: false })) },
      controlIsOn: vi.fn(async () => true),
      hashExternalKey: hash,
      fetchImpl: autoFetch,
      now: () => now,
    });
    await expect(auto.sendEligibleReply({
      channel: "facebook",
      externalConversationKey: psid,
      latestCustomerMessageKey: messageKey,
      brainVersion: "brain-v1",
      risk: "GREEN",
      replyText: "Autonomous reply",
    })).resolves.toEqual({ status: "duplicate_or_terminal" });
    expect(autoFetch).not.toHaveBeenCalled();
  });

  it("allows a new idempotency key after a definite 4xx failure", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("invalid", { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message_id: "mid.sent.2" }), { status: 200 }));
    const current = setup(fetchImpl);
    await expect(current.sender.send(input)).resolves.toEqual({ status: "failed" });
    await expect(current.sender.send({ ...input, idempotencyKey: "manual-click-2" })).resolves.toMatchObject({ status: "sent" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("records an uncertain outcome and blocks blind retry with the same idempotency key", async () => {
    const current = setup(vi.fn(async () => new Response("unavailable", { status: 503 })));
    await expect(current.sender.send(input)).resolves.toEqual({ status: "delivery_uncertain" });
    await expect(current.sender.send(input)).resolves.toEqual({ status: "delivery_uncertain" });
    expect(current.fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not mark a provider send as sent before durable inbox reconciliation succeeds", async () => {
    const current = setup();
    current.recordSent.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(current.sender.send(input)).resolves.toEqual({ status: "delivery_uncertain" });
    await expect(current.sender.send(input)).resolves.toEqual({ status: "delivery_uncertain" });
    expect(current.fetchImpl).toHaveBeenCalledOnce();
    expect(current.loadItem).not.toHaveBeenCalled();
  });
});
