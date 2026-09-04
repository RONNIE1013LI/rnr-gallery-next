import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { InMemoryReplyRuntimeStore } from "../runtime-store/in-memory-reply-runtime-store";
import {
  DisabledMetaReplySender,
  createMetaReplySender,
  createMetaSenderEchoMatcher,
  type MetaReplyCandidate,
} from "./reply-sender";
import type { MetaConversationSnapshot } from "./types";

const candidate: MetaReplyCandidate = Object.freeze({
  channel: "facebook",
  externalConversationKey: "customer-provider-id",
  latestCustomerMessageKey: "customer-message-id",
  brainVersion: "0.5.1",
  risk: "GREEN",
  replyText: "Yes, we can help with that.",
});

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function setup(input: Readonly<{
  masterEnabled?: boolean;
  engineMode?: "legacy" | "shadow" | "shared_draft" | "shared_active";
  metaAutoSendEnabled?: boolean;
  accessToken?: string;
  controlIsOn?: boolean;
  takeover?: boolean;
  latestMessageKey?: string;
  latestReceivedAt?: Date;
  latestRole?: "customer" | "staff";
  snapshotComplete?: boolean;
  snapshotIncompleteReason?: MetaConversationSnapshot["incompleteReason"];
  stageAAllowedRecipientHash?: string | null;
  stageAActivatedAt?: Date | null;
  fetchImpl?: typeof fetch;
  logEligibilityEvaluation?: (entry: unknown) => void;
  logDeliveryTrace?: (entry: unknown) => void;
  traceNow?: () => Date;
}> = {}) {
  const store = new InMemoryReplyRuntimeStore({
    now: () => Date.parse("2026-09-04T01:00:00.000Z"),
  });
  const fetchImpl = input.fetchImpl ?? vi.fn(async () => Response.json({ message_id: "provider-message-id" }));
  const eligibilityLog = vi.fn();
  const deliveryTrace = vi.fn();
  const context = {
    loadConversation: vi.fn(async () => ({
      channel: "facebook" as const,
      complete: input.snapshotComplete ?? true,
      incompleteReason: input.snapshotIncompleteReason ?? null,
      characters: 5,
      turnsConsidered: 1,
      events: [{
        channel: "facebook" as const,
        role: input.latestRole ?? "customer" as const,
        eventType: "customer_message" as const,
        externalConversationKey: candidate.externalConversationKey,
        externalMessageKey: input.latestMessageKey ?? candidate.latestCustomerMessageKey,
        externalReplyToMessageKey: null,
        text: "Hello",
        attachments: [],
        receivedAt: input.latestReceivedAt ?? new Date("2026-09-04T01:00:00.000Z"),
      }],
    })),
  };
  const sender = createMetaReplySender({
    config: {
      masterEnabled: input.masterEnabled ?? true,
      engineMode: input.engineMode ?? "shared_active",
      metaAutoSendEnabled: input.metaAutoSendEnabled ?? true,
      stageAAllowedRecipientHash: input.stageAAllowedRecipientHash === undefined
        ? hash(candidate.externalConversationKey)
        : input.stageAAllowedRecipientHash,
      stageAActivatedAt: input.stageAActivatedAt === undefined ? new Date(0) : input.stageAActivatedAt,
    },
    accessToken: input.accessToken ?? "test-page-access-token",
    pageId: "page-id",
    store,
    context,
    takeover: { read: vi.fn(async () => ({ active: input.takeover ?? false })) },
    controlIsOn: vi.fn(async () => input.controlIsOn ?? true),
    hashExternalKey: hash,
    fetchImpl,
    now: () => new Date("2026-09-04T01:01:00.000Z"),
    logEligibilityEvaluation: input.logEligibilityEvaluation ?? eligibilityLog,
    logDeliveryTrace: input.logDeliveryTrace ?? deliveryTrace,
    traceNow: input.traceNow ?? (() => new Date("2026-09-04T01:00:00.100Z")),
  });
  return { sender, store, fetchImpl, context, eligibilityLog, deliveryTrace };
}

describe("Meta reply sender", () => {
  it("does not claim or call Graph for an unmatched Stage A recipient", async () => {
    const current = await setup({ stageAAllowedRecipientHash: hash("another-customer") });
    await expect(current.sender.sendEligibleReply(candidate)).resolves.toEqual({ status: "blocked" });
    expect(current.fetchImpl).not.toHaveBeenCalled();
    expect(current.store.exportStateForTest().deliveries).toHaveLength(0);
  });

  it.each([
    ["missing recipient hash", { stageAAllowedRecipientHash: null }],
    ["missing cutoff", { stageAActivatedAt: null }],
  ])("does not claim or call Graph with %s", async (_label, override) => {
    const current = await setup(override);
    await expect(current.sender.sendEligibleReply(candidate)).resolves.toEqual({ status: "blocked" });
    expect(current.fetchImpl).not.toHaveBeenCalled();
    expect(current.store.exportStateForTest().deliveries).toHaveLength(0);
  });

  it("does not claim or call Graph when the final latest customer event predates Stage A", async () => {
    const current = await setup({
      stageAActivatedAt: new Date("2026-09-04T01:00:00.000Z"),
      latestReceivedAt: new Date("2026-09-04T00:59:59.999Z"),
    });
    await expect(current.sender.sendEligibleReply(candidate)).resolves.toEqual({ status: "blocked" });
    expect(current.fetchImpl).not.toHaveBeenCalled();
    expect(current.store.exportStateForTest().deliveries).toHaveLength(0);
  });

  it.each([
    ["missing_activation", { stageAActivatedAt: null }],
    ["control_off", { controlIsOn: false }],
    ["takeover_active", { takeover: true }],
    ["snapshot_incomplete", {
      snapshotComplete: false,
      snapshotIncompleteReason: "provider_unavailable" as const,
    }],
    ["latest_not_customer", { latestRole: "staff" as const }],
    ["latest_message_mismatch", { latestMessageKey: "newer-message" }],
    ["pre_activation", {
      stageAActivatedAt: new Date("2026-09-04T01:00:00.000Z"),
      latestReceivedAt: new Date("2026-09-04T00:59:59.999Z"),
    }],
  ])("records the exact pre-claim reason %s without claiming", async (reason, override) => {
    const current = await setup(override);

    await expect(current.sender.sendEligibleReply(candidate)).resolves.toEqual({ status: "blocked" });

    expect(current.eligibilityLog).toHaveBeenCalledOnce();
    expect(current.eligibilityLog).toHaveBeenCalledWith(expect.objectContaining({
      phase: "pre_claim",
      eligible: false,
      reason,
      candidateLatestCustomerMessageKeyHash: hash(candidate.latestCustomerMessageKey),
    }));
    expect(current.store.exportStateForTest().deliveries).toHaveLength(0);
  });

  it("records safe pre-claim and pre-send eligible evaluations", async () => {
    const current = await setup();

    await expect(current.sender.sendEligibleReply(candidate)).resolves.toEqual({ status: "sent" });

    expect(current.eligibilityLog).toHaveBeenCalledTimes(2);
    expect(current.eligibilityLog.mock.calls.map(([entry]) => entry)).toEqual([
      expect.objectContaining({
        phase: "pre_claim",
        eligible: true,
        reason: "eligible",
        controlOn: true,
        takeoverActive: false,
        snapshotComplete: true,
        snapshotIncompleteReason: null,
        latestRole: "customer",
        latestExternalMessageKeyHash: hash(candidate.latestCustomerMessageKey),
        candidateLatestCustomerMessageKeyHash: hash(candidate.latestCustomerMessageKey),
        latestMessageMatches: true,
        latestReceivedAt: "2026-09-04T01:00:00.000Z",
        stageAActivatedAt: "1970-01-01T00:00:00.000Z",
        activationComparison: true,
      }),
      expect.objectContaining({
        phase: "pre_send",
        eligible: true,
        reason: "eligible",
      }),
    ]);
    expect(JSON.stringify(current.eligibilityLog.mock.calls)).not.toContain(candidate.externalConversationKey);
    expect(JSON.stringify(current.eligibilityLog.mock.calls)).not.toContain(candidate.latestCustomerMessageKey);
    expect(JSON.stringify(current.eligibilityLog.mock.calls)).not.toContain(candidate.replyText);
    expect(JSON.stringify(current.eligibilityLog.mock.calls)).not.toContain("Hello");
    expect(JSON.stringify(current.eligibilityLog.mock.calls)).not.toContain("test-page-access-token");
  });

  it("does not let diagnostic logging alter sender behavior", async () => {
    const current = await setup({
      logEligibilityEvaluation: () => { throw new Error("diagnostic sink unavailable"); },
    });

    await expect(current.sender.sendEligibleReply(candidate)).resolves.toEqual({ status: "sent" });
    expect(current.fetchImpl).toHaveBeenCalledOnce();
  });

  it("keeps the disabled sender incapable of a Graph request", async () => {
    await expect(new DisabledMetaReplySender().sendEligibleReply(candidate))
      .resolves.toEqual({ status: "disabled" });
  });

  it.each([
    ["auto-send false", { metaAutoSendEnabled: false }],
    ["master false", { masterEnabled: false }],
    ["wrong engine mode", { engineMode: "shared_draft" as const }],
    ["credential missing", { accessToken: "" }],
    ["control off", { controlIsOn: false }],
    ["takeover active", { takeover: true }],
    ["latest message changed", { latestMessageKey: "newer-message" }],
  ])("does not call Graph when %s", async (_label, override) => {
    const current = await setup(override);
    await expect(current.sender.sendEligibleReply(candidate)).resolves.toMatchObject({ status: "blocked" });
    expect(current.fetchImpl).not.toHaveBeenCalled();
  });

  it("does not claim or call Graph for a non-GREEN candidate", async () => {
    const current = await setup();
    await expect(current.sender.sendEligibleReply({ ...candidate, risk: "YELLOW" }))
      .resolves.toEqual({ status: "blocked" });
    expect(current.fetchImpl).not.toHaveBeenCalled();
    expect(current.store.exportStateForTest().deliveries).toHaveLength(0);
  });

  it("permits only one Graph POST across 20 concurrent attempts and settles a masked provider ID", async () => {
    const current = await setup();
    const results = await Promise.all(Array.from({ length: 20 }, () => current.sender.sendEligibleReply(candidate)));
    expect(current.fetchImpl).toHaveBeenCalledOnce();
    expect(results.filter((result) => result.status === "sent")).toHaveLength(1);
    expect(results.filter((result) => result.status === "duplicate_or_terminal")).toHaveLength(19);
    const delivery = current.store.exportStateForTest().deliveries[0]?.[1].result;
    expect(delivery).toMatchObject({ status: "sent", providerMessageIdMasked: expect.stringMatching(/^[a-f0-9]{12}$/) });
    expect(JSON.stringify(delivery)).not.toContain("provider-message-id");
  });

  it("records the successful delivery execution phases with one safe correlation", async () => {
    const current = await setup();

    await expect(current.sender.sendEligibleReply(candidate)).resolves.toEqual({ status: "sent" });

    const entries = current.deliveryTrace.mock.calls.map(([entry]) => entry);
    expect(entries.map((entry) => entry.phase)).toEqual([
      "delivery_claimed",
      "begin_delivery_send_start",
      "begin_delivery_send_success",
      "graph_post_start",
      "graph_post_response",
      "sender_final",
    ]);
    expect(entries[0]).toMatchObject({
      claimedAt: "2026-09-04T01:00:00.100Z",
      leaseExpiresAt: "2026-09-04T01:01:00.000Z",
      millisecondsUntilExpiry: 59_900,
    });
    expect(entries[4]).toMatchObject({ httpStatus: 200, responseOk: true });
    expect(entries[5]).toMatchObject({
      finalSenderStatus: "sent",
      providerMessageIdMasked: expect.stringMatching(/^[a-f0-9]{12}$/),
    });
    expect(new Set(entries.map((entry) => entry.deliveryKeyMasked)).size).toBe(1);
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain(candidate.externalConversationKey);
    expect(serialized).not.toContain(candidate.latestCustomerMessageKey);
    expect(serialized).not.toContain(candidate.replyText);
    expect(serialized).not.toContain("test-page-access-token");
    expect(serialized).not.toContain("provider-message-id");
  });

  it("records beginDeliverySend failure and preserves the blocked result", async () => {
    const current = await setup();
    vi.spyOn(current.store, "beginDeliverySend")
      .mockRejectedValueOnce(new Error("Delivery lease is no longer valid"));

    await expect(current.sender.sendEligibleReply(candidate)).resolves.toEqual({ status: "blocked" });

    expect(current.fetchImpl).not.toHaveBeenCalled();
    expect(current.deliveryTrace.mock.calls.map(([entry]) => entry.phase)).toEqual([
      "delivery_claimed",
      "begin_delivery_send_start",
      "begin_delivery_send_error",
      "release_delivery_start",
      "release_delivery_success",
      "sender_final",
    ]);
    expect(current.deliveryTrace).toHaveBeenCalledWith(expect.objectContaining({
      phase: "begin_delivery_send_error",
      errorName: "Error",
      errorMessage: "Delivery lease is no longer valid",
      currentTime: "2026-09-04T01:00:00.100Z",
      leaseExpiresAt: "2026-09-04T01:01:00.000Z",
      elapsedSinceClaim: 0,
    }));
    expect(current.deliveryTrace).toHaveBeenLastCalledWith(expect.objectContaining({
      phase: "sender_final",
      finalSenderStatus: "blocked",
    }));
  });

  it("records a safe Meta Graph 4xx response before releasing delivery", async () => {
    const current = await setup({
      fetchImpl: vi.fn(async () => Response.json({
        error: {
          type: "OAuthException",
          code: 190,
          error_subcode: 463,
          message: "Invalid token test-page-access-token at https://graph.facebook.com/private",
        },
      }, { status: 400 })),
    });

    await expect(current.sender.sendEligibleReply(candidate)).resolves.toEqual({ status: "blocked" });

    expect(current.deliveryTrace.mock.calls.map(([entry]) => entry.phase)).toEqual([
      "delivery_claimed",
      "begin_delivery_send_start",
      "begin_delivery_send_success",
      "graph_post_start",
      "graph_post_response",
      "release_delivery_start",
      "release_delivery_success",
      "sender_final",
    ]);
    const responseEntry = current.deliveryTrace.mock.calls
      .map(([entry]) => entry)
      .find((entry) => entry.phase === "graph_post_response");
    expect(responseEntry).toMatchObject({
      httpStatus: 400,
      responseOk: false,
      graphErrorType: "OAuthException",
      graphErrorCode: 190,
      graphErrorSubcode: 463,
    });
    expect(JSON.stringify(responseEntry)).not.toContain("test-page-access-token");
    expect(JSON.stringify(responseEntry)).not.toContain("graph.facebook.com/private");
    expect(current.store.exportStateForTest().deliveries).toHaveLength(0);
  });

  it("redacts customer text, identity, credentials and URLs in every diagnostic entry", async () => {
    const sensitive=["test-page-access-token",candidate.externalConversationKey,candidate.latestCustomerMessageKey,candidate.replyText,"https://example.test/private-image","Bearer opaque-credential","access_token=private-token"];
    const current=await setup({fetchImpl:vi.fn(async()=>Response.json({error:{type:sensitive.join(" "),message:sensitive.join(" "),code:190,ignoredBody:"UNTRUSTED_RESPONSE_BODY"}},{status:400}))});
    await current.sender.sendEligibleReply(candidate);
    const diagnostics=JSON.stringify([...current.eligibilityLog.mock.calls,...current.deliveryTrace.mock.calls]);
    for(const value of [...sensitive,"UNTRUSTED_RESPONSE_BODY"])expect(diagnostics).not.toContain(value);
    expect(current.deliveryTrace).toHaveBeenCalledWith(expect.objectContaining({phase:"graph_post_response",graphErrorCode:190}));
  });

  it("records releaseDelivery failure without replacing the existing uncertain outcome", async () => {
    const current = await setup({
      fetchImpl: vi.fn(async () => Response.json({ error: { code: 190 } }, { status: 400 })),
    });
    vi.spyOn(current.store, "releaseDelivery")
      .mockRejectedValueOnce(new Error("Delivery lease is no longer valid"));

    await expect(current.sender.sendEligibleReply(candidate))
      .resolves.toEqual({ status: "delivery_uncertain" });

    expect(current.deliveryTrace).toHaveBeenCalledWith(expect.objectContaining({
      phase: "release_delivery_error",
      errorName: "Error",
      errorMessage: "Delivery lease is no longer valid",
    }));
    expect(current.deliveryTrace).toHaveBeenLastCalledWith(expect.objectContaining({
      phase: "sender_final",
      finalSenderStatus: "delivery_uncertain",
    }));
  });

  it("recognizes a sender-originated echo using only a stored HMAC marker", async () => {
    const current = await setup();
    await expect(current.sender.sendEligibleReply(candidate)).resolves.toMatchObject({ status: "sent" });
    const matcher = createMetaSenderEchoMatcher({ store: current.store, hashExternalKey: hash });
    await expect(matcher({
      channel: "facebook",
      role: "staff",
      eventType: "human_outbound",
      externalConversationKey: candidate.externalConversationKey,
      externalMessageKey: "provider-message-id",
      externalReplyToMessageKey: null,
      text: candidate.replyText,
      attachments: [],
      receivedAt: new Date("2026-09-04T01:01:01.000Z"),
    })).resolves.toBe(true);
  });

  it("marks an uncertain transport terminally and never blindly retries", async () => {
    const fetchImpl = vi.fn(async () => { throw new DOMException("timeout", "TimeoutError"); });
    const current = await setup({ fetchImpl });
    await expect(current.sender.sendEligibleReply(candidate)).resolves.toEqual({ status: "delivery_uncertain" });
    await expect(current.sender.sendEligibleReply(candidate)).resolves.toEqual({ status: "duplicate_or_terminal" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(current.store.exportStateForTest().deliveries[0]?.[1].result)
      .toMatchObject({ status: "delivery_uncertain", providerMessageIdMasked: null });
  });
});
