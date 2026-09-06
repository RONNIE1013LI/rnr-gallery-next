import { describe, expect, it, vi } from "vitest";
import { loadBusinessBrain } from "../business-brain/loader";
import type { RnrAiDecision, RnrAiRequest } from "../types";
import { assembleConversationContext } from "../context/assembler";
import { createWebsiteBrainAdapter } from "./website-brain-adapter";

const green: RnrAiDecision = {
  risk: "GREEN",
  intent: "photo_guidance",
  replyText: "Raw model wording must never be published.",
  reasons: [],
  claims: [{ kind: "design", value: "Subjects can be combined", sourceId: "design-capabilities" }],
  toolEvidence: [],
  nextAction: "AUTO_REPLY_ELIGIBLE",
  providerRun: { model: "gpt-5.6-luna", usage: { inputTokens: 20, cachedInputTokens: 4, outputTokens: 8 } },
};

function setup(decision: RnrAiDecision = green) {
  const brain = { generate: vi.fn(async (request: RnrAiRequest, execution?: Readonly<{ deadlineAt?: number }>) => {
    void execution;
    void request;
    return decision;
  }) };
  return { brain, adapter: createWebsiteBrainAdapter({ brain, businessBrain: loadBusinessBrain() }) };
}

const input = {
  current: { id: "11111111-1111-4111-8111-111111111111", text: "Can you combine them?", pageMarket: "NZ" as const, productContext: null },
  context: [
    { role: "customer" as const, text: "I have two photos", receivedAt: "2026-09-04T00:00:00.000Z" },
    { role: "staff" as const, text: "Yes, please send both", receivedAt: "2026-09-04T00:01:00.000Z" },
    { role: "customer" as const, text: "Can you combine them?", receivedAt: "2026-09-04T00:02:00.000Z" },
  ],
  expectedIntent: "photo_guidance" as const,
};

describe("Website shared-brain adapter", () => {
  it("preserves the complete transcript and exact shared decision without template conversion", async () => {
    const current = setup();
    const result = await current.adapter.generate(input);
    const request = current.brain.generate.mock.calls[0][0];
    expect(request.conversation.map((turn) => turn.text)).toEqual(input.context.map((turn) => turn.text));
    expect(request.channel).toBe("website");
    expect(result.decision).toBe(green);
    expect(result.text).toBe(green.replyText);
    expect(result.usage).toEqual(green.providerRun?.usage);
  });
  it.each(["YELLOW", "RED"] as const)("preserves %s review instead of promoting it", async (risk) => {
    const decision = { ...green, risk, nextAction: "HUMAN_REVIEW" as const };
    const result = await setup(decision).adapter.generate(input);
    expect(result.decision).toBe(decision);
  });
  it("preserves a claim-free clarification and no-reply decision", async () => {
    const decision = { ...green, claims: [], replyText: "Which size would you like?" };
    expect((await setup(decision).adapter.generate(input)).text).toBe(decision.replyText);
    const silent = { ...green, replyText: null, claims: [], nextAction: "NO_REPLY" as const };
    expect((await setup(silent).adapter.generate(input)).decision).toBe(silent);
  });
  it("labels page product separately without inventing a customer market turn", async () => {
    const current = setup();
    await current.adapter.generate({ ...input, current: { ...input.current, productContext: { category: "canvas", productKey: "digital-oil-painting-canvas" } } });
    const request = current.brain.generate.mock.calls[0][0];
    expect(request.pageContext).toEqual({ category: "canvas", productKey: "digital-oil-painting-canvas" });
    expect(request.conversation.map((turn) => turn.text)).toEqual(input.context.map((turn) => turn.text));
  });
  it("preserves causal order for same-timestamp turns and supplies the shared 40s budget", async () => {
    const current = setup();
    const before = Date.now();
    await current.adapter.generate({ ...input, context: input.context.map((turn) => ({ ...turn, receivedAt: input.context[0].receivedAt })) });
    const call = current.brain.generate.mock.calls[0];
    expect(call[1]?.deadlineAt).toBeGreaterThanOrEqual(before + 40_000);
    const assembled = assembleConversationContext(call[0].conversation);
    expect(assembled.modelText.indexOf("I have two photos")).toBeLessThan(assembled.modelText.indexOf("Yes, please send both"));
    expect(assembled.modelText.indexOf("Yes, please send both")).toBeLessThan(assembled.modelText.indexOf("Can you combine them?"));
  });

});
