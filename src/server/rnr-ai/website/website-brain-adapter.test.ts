import { describe, expect, it, vi } from "vitest";
import { loadBusinessBrain } from "../business-brain/loader";
import type { RnrAiDecision, RnrAiRequest } from "../types";
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
  const brain = { generate: vi.fn(async (request: RnrAiRequest) => {
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
  it("passes the complete authorized Website transcript and maps supported GREEN claims to a local decision", async () => {
    const current = setup();
    const result = await current.adapter.generate(input);
    const request = current.brain.generate.mock.calls[0][0];
    expect(request.channel).toBe("website");
    expect(request.market).toBe("NZ");
    expect(request.conversation.map((turn) => turn.text)).toEqual(input.context.map((turn) => turn.text));
    expect(JSON.parse(result.text)).toMatchObject({
      response_type: "ANSWER_SAFE",
      intent: "photo_guidance",
      allowed_facts: ["PHOTO_COMBINE_SUBJECTS"],
      human_review_reason: "NONE",
    });
    expect(result.text).not.toContain("Raw model wording");
    expect(result.usage).toEqual(green.providerRun?.usage);
  });

  it.each(["YELLOW", "RED"] as const)("maps %s to human review with no public facts", async (risk) => {
    const current = setup({ ...green, risk, nextAction: "HUMAN_REVIEW" });
    await expect(current.adapter.generate(input)).resolves.toMatchObject({
      text: expect.stringContaining('"response_type":"HUMAN_REVIEW_REQUIRED"'),
    });
    expect(JSON.parse((await current.adapter.generate(input)).text)).toMatchObject({
      allowed_facts: [], human_review_reason: risk === "RED" ? "HIGH_RISK" : "MODEL_UNCERTAIN",
    });
  });

  it("maps a safe no-reply result without using model text", async () => {
    const current = setup({ ...green, replyText: null, claims: [], nextAction: "NO_REPLY" });
    expect(JSON.parse((await current.adapter.generate({ ...input, expectedIntent: "tone_adjustment" })).text))
      .toMatchObject({ response_type: "NO_REPLY_NEEDED", allowed_facts: [], human_review_reason: "NONE" });
  });

  it("fails closed when GREEN has no locally renderable supported claim", async () => {
    const current = setup({ ...green, claims: [] });
    expect(JSON.parse((await current.adapter.generate(input)).text))
      .toMatchObject({ response_type: "HUMAN_REVIEW_REQUIRED", human_review_reason: "MODEL_UNCERTAIN" });
  });
});
