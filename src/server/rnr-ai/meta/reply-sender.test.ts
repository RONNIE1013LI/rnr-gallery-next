import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { InMemoryReplyRuntimeStore } from "../runtime-store/in-memory-reply-runtime-store";
import {
  DisabledMetaReplySender,
  createMetaReplySender,
  createMetaSenderEchoMatcher,
  type MetaReplyCandidate,
} from "./reply-sender";

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
  stageAAllowedRecipientHash?: string | null;
  stageAActivatedAt?: Date | null;
  fetchImpl?: typeof fetch;
}> = {}) {
  const store = new InMemoryReplyRuntimeStore();
  const fetchImpl = input.fetchImpl ?? vi.fn(async () => Response.json({ message_id: "provider-message-id" }));
  const context = {
    loadConversation: vi.fn(async () => ({
      channel: "facebook" as const,
      complete: true,
      incompleteReason: null,
      characters: 5,
      turnsConsidered: 1,
      events: [{
        channel: "facebook" as const,
        role: "customer" as const,
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
  });
  return { sender, store, fetchImpl, context };
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
