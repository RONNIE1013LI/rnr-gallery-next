import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadBusinessBrain } from "../business-brain/loader";
import { InMemoryReplyRuntimeStore } from "../runtime-store/in-memory-reply-runtime-store";
import type { RnrAiDecision } from "../types";
import { createHumanTakeoverService } from "./human-takeover";
import { MetaImageResolutionError } from "./image-resolver";
import { createMetaReplyOrchestrator } from "./orchestrator";
import { createMetaReviewPayloadProtector } from "./review-payload-protector";
import type { MetaConversationEvent, MetaConversationSnapshot } from "./types";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const now = new Date("2026-09-04T00:10:00.000Z");

function event(overrides: Partial<MetaConversationEvent> = {}): MetaConversationEvent {
  return {
    channel: "facebook",
    role: "customer",
    eventType: "customer_message",
    externalConversationKey: "conversation-raw",
    externalMessageKey: "message-raw",
    externalReplyToMessageKey: null,
    text: "How much is a roll-up banner?",
    attachments: [],
    receivedAt: new Date("2026-09-04T00:09:00.000Z"),
    ...overrides,
  };
}

function snapshot(events: readonly MetaConversationEvent[] = [event()]): MetaConversationSnapshot {
  return {
    channel: "facebook",
    events: events.map((item) => ({ ...item, attachments: item.attachments.map(({ ordinal, kind }) => ({ ordinal, kind })) })),
    complete: true,
    incompleteReason: null,
    characters: events.reduce((sum, item) => sum + (item.text?.length ?? 0), 0),
    turnsConsidered: events.length,
  };
}

const greenDecision: RnrAiDecision = {
  risk: "GREEN",
  intent: "price",
  replyText: "The NZ Roll-Up Banner is NZ$264.50 including GST.",
  reasons: [],
  claims: [{ kind: "price", value: "NZ$264.50", sourceId: "nz-roll-up-banner" }],
  toolEvidence: [],
  nextAction: "AUTO_REPLY_ELIGIBLE",
};

async function setup(options: Readonly<{
  masterEnabled?: boolean;
  stageAAllowedRecipientHash?: string | null;
  stageAActivatedAt?: Date | null;
  decision?: RnrAiDecision;
  snapshots?: readonly MetaConversationSnapshot[];
}> = {}) {
  const store = new InMemoryReplyRuntimeStore({ now: () => now.getTime() });
  await store.compareAndSetControl(0, { revision: 1, mode: "ON", timezone: "Pacific/Auckland", periods: [], override: null });
  let contextIndex = 0;
  const context = { loadConversation: vi.fn(async () => options.snapshots?.[contextIndex++] ?? options.snapshots?.at(-1) ?? snapshot()) };
  const images = { resolveMetaImages: vi.fn(async () => []) };
  const brain = { generate: vi.fn(async () => options.decision ?? greenDecision) };
  const sender = { sendEligibleReply: vi.fn(async () => ({ status: "disabled" as const })) };
  const takeover = createHumanTakeoverService({ store, hashExternalKey: hash, isSenderEcho: async () => false });
  const orchestrator = createMetaReplyOrchestrator({
    store,
    context,
    images,
    brain,
    takeover,
    reviewProtector: createMetaReviewPayloadProtector("review-secret-that-is-at-least-32-characters"),
    businessBrain: loadBusinessBrain(),
    hashExternalKey: hash,
    resolveMarket: () => "NZ",
    pageId: "page-1",
    masterEnabled: options.masterEnabled ?? true,
    stageAAllowedRecipientHash: options.stageAAllowedRecipientHash === undefined
      ? hash("conversation-raw")
      : options.stageAAllowedRecipientHash,
    stageAActivatedAt: options.stageAActivatedAt === undefined ? new Date(0) : options.stageAActivatedAt,
    sender,
    now: () => now,
  });
  return { store, context, images, brain, sender, takeover, orchestrator };
}

describe("MetaReplyOrchestrator", () => {
  it.each([
    ["customer", "customer_message"],
    ["staff", "human_outbound"],
  ] as const)("rejects an unmatched %s event before shared runtime work", async (role, eventType) => {
    const current = await setup({ stageAAllowedRecipientHash: hash("approved-conversation") });
    await expect(current.orchestrator.handle(event({ role, eventType })))
      .resolves.toMatchObject({ acknowledged: true, status: "stage_a_not_allowed" });
    expect(current.context.loadConversation).not.toHaveBeenCalled();
    expect(current.images.resolveMetaImages).not.toHaveBeenCalled();
    expect(current.brain.generate).not.toHaveBeenCalled();
    expect(current.sender.sendEligibleReply).not.toHaveBeenCalled();
    expect(current.store.exportStateForTest().events).toHaveLength(0);
  });

  it.each([
    ["missing cutoff", null, event()],
    ["pre-cutoff event", new Date("2026-09-04T00:10:00.000Z"), event()],
  ] as const)("rejects a controlled recipient before shared runtime work with %s", async (_label, stageAActivatedAt, incoming) => {
    const current = await setup({ stageAActivatedAt });
    await expect(current.orchestrator.handle(incoming))
      .resolves.toMatchObject({ acknowledged: true, status: "stage_a_not_active" });
    expect(current.context.loadConversation).not.toHaveBeenCalled();
    expect(current.images.resolveMetaImages).not.toHaveBeenCalled();
    expect(current.brain.generate).not.toHaveBeenCalled();
    expect(current.sender.sendEligibleReply).not.toHaveBeenCalled();
    expect(current.store.exportStateForTest().events).toHaveLength(0);
  });

  it("acknowledges OFF with zero Graph, image, Brain and sender work", async () => {
    const current = await setup({ masterEnabled: false });
    await expect(current.orchestrator.handle(event())).resolves.toMatchObject({ acknowledged: true, status: "off" });
    expect(current.context.loadConversation).not.toHaveBeenCalled();
    expect(current.images.resolveMetaImages).not.toHaveBeenCalled();
    expect(current.brain.generate).not.toHaveBeenCalled();
    expect(current.sender.sendEligibleReply).not.toHaveBeenCalled();
  });

  it("allows one worker across twenty concurrent deliveries and never sends in Phase 2", async () => {
    const current = await setup();
    const results = await Promise.all(Array.from({ length: 20 }, () => current.orchestrator.handle(event())));
    expect(results.filter((result) => result.status === "delivery_candidate_disabled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "duplicate")).toHaveLength(19);
    expect(current.brain.generate).toHaveBeenCalledTimes(1);
    expect(current.sender.sendEligibleReply).toHaveBeenCalledOnce();
    expect(current.sender.sendEligibleReply).toHaveBeenCalledWith(expect.objectContaining({
      channel: "facebook",
      externalConversationKey: "conversation-raw",
      latestCustomerMessageKey: "message-raw",
      brainVersion: "0.5.1",
      risk: "GREEN",
      replyText: greenDecision.replyText,
    }));
  });

  it("activates takeover for a human staff echo before model work", async () => {
    const current = await setup();
    await expect(current.orchestrator.handle(event({ role: "staff", eventType: "human_outbound", text: "I will help" })))
      .resolves.toMatchObject({ status: "human_takeover" });
    expect(await current.takeover.read("conversation-raw")).toMatchObject({ active: true, source: "staff_echo" });
    expect(current.brain.generate).not.toHaveBeenCalled();
  });

  it("encrypts YELLOW review content for 48 hours and activates takeover", async () => {
    const current = await setup({ decision: { ...greenDecision, risk: "YELLOW", nextAction: "HUMAN_REVIEW", replyText: "Private draft" } });
    const result = await current.orchestrator.handle(event());
    expect(result).toMatchObject({ status: "review", risk: "YELLOW" });
    const ciphertext = await current.store.readEncryptedReview(result.reviewKey!);
    expect(ciphertext).toMatch(/^v1\./);
    expect(ciphertext).not.toContain("Private draft");
    expect(await current.takeover.read("conversation-raw")).toMatchObject({ active: true, source: "risk" });
  });

  it("cancels a candidate when a newer customer message or OFF state wins the final recheck", async () => {
    const newer = event({ externalMessageKey: "newer-message", receivedAt: new Date("2026-09-04T00:09:30Z") });
    const changed = await setup({ snapshots: [snapshot(), snapshot([event(), newer])] });
    await expect(changed.orchestrator.handle(event())).resolves.toMatchObject({ status: "stale" });

    const switched = await setup();
    switched.brain.generate.mockImplementationOnce(async () => {
      const control = await switched.store.readControl();
      await switched.store.compareAndSetControl(control.config.revision, {
        revision: control.config.revision + 1,
        mode: "OFF",
        timezone: "Pacific/Auckland",
        periods: [],
        override: null,
      });
      return greenDecision;
    });
    await expect(switched.orchestrator.handle(event())).resolves.toMatchObject({ status: "off_before_candidate" });
    expect(switched.sender.sendEligibleReply).not.toHaveBeenCalled();
  });

  it("honours a human takeover that arrives while the model is running", async () => {
    const current = await setup();
    current.brain.generate.mockImplementationOnce(async () => {
      await current.takeover.set("conversation-raw", true, "staff_echo", now);
      return greenDecision;
    });
    await expect(current.orchestrator.handle(event())).resolves.toMatchObject({ status: "human_takeover" });
    expect(current.sender.sendEligibleReply).not.toHaveBeenCalled();
  });

  it("turns an image resolution failure into review takeover without a generic model answer", async () => {
    const current = await setup();
    current.images.resolveMetaImages.mockRejectedValueOnce(new MetaImageResolutionError());
    await expect(current.orchestrator.handle(event({
      attachments: [{ externalAttachmentKey: "image-1", ordinal: 0, kind: "image", sourceRef: { kind: "facebook_remote", url: "https://scontent.test/image.jpg" }, mimeTypeHint: null, failureCode: null }],
    }))).resolves.toMatchObject({ status: "review", risk: "YELLOW" });
    expect(current.brain.generate).not.toHaveBeenCalled();
    expect(await current.takeover.read("conversation-raw")).toMatchObject({ active: true, source: "risk" });
  });

  it("keeps orchestration and backlog free of Neon, product registry and channel send implementation", () => {
    const source = ["orchestrator.ts", "backlog-reconciler.ts"]
      .map((file) => readFileSync(resolve("src/server/rnr-ai/meta", file), "utf8"))
      .join("\n");
    expect(source).not.toMatch(/getDatabase|drizzle|customer_service_|product-registry|graph\.facebook\.com|\/messages/i);
  });
});
