import { describe, expect, it, vi } from "vitest";
import {
  createWebsiteReplyRuntime,
  createBudgetedWebsiteFetch,
} from "./website-runtime";
import { fixture } from "./website-test-helper";
const decision = {
  risk: "GREEN" as const,
  intent: "sizes",
  replyText: "We offer A4 sizes.",
  reasons: [],
  claims: [],
  toolEvidence: [],
  nextAction: "AUTO_REPLY_ELIGIBLE" as const,
};
describe("website shared runtime", () => {
  it("publishes a validated reply once and never regenerates on duplicate processing", async () => {
    const f = fixture(),
      generate = vi.fn(async () => ({ text: decision.replyText, decision }));
    const runtime = createWebsiteReplyRuntime({
      repository: f.repository,
      brain: { generate },
    });
    const turn = await f.repository.ingestConversationEvent(f.event());
    if (turn.status !== "turn_pending") throw Error();
    await runtime.processTurn(turn.turnId, "shared_brain");
    await runtime.processTurn(turn.turnId, "shared_brain");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(
      (await f.repository.listQueue(5)).items[0].timeline.at(-1)?.role,
    ).toBe("assistant");
  });
  it("opens review on provider failure; draft is never a public reply", async () => {
    const f = fixture(),
      runtime = createWebsiteReplyRuntime({
        repository: f.repository,
        brain: {
          generate: async () => {
            throw Error("provider failed");
          },
        },
      });
    const turn = await f.repository.ingestConversationEvent(f.event());
    if (turn.status !== "turn_pending") throw Error();
    expect(await runtime.processTurn(turn.turnId, "shared_brain")).toEqual({
      status: "review",
    });
    expect(
      (await f.repository.listQueue(5)).items[0].websiteReview?.reason,
    ).toBe("provider_error");
  });
});

describe("website provider admission gates", () => {
  it("does not claim or generate when master gate is off", async () => {
    const f = fixture(),
      generate = vi.fn(),
      runtime = createWebsiteReplyRuntime({
        repository: f.repository,
        brain: { generate },
        enabled: () => false,
      });
    const turn = await f.repository.ingestConversationEvent(f.event());
    if (turn.status !== "turn_pending") throw Error();
    expect(await runtime.processTurn(turn.turnId, "shared_brain")).toEqual({
      status: "disabled",
    });
    expect(generate).not.toHaveBeenCalled();
    expect(await f.repository.pendingTurnIds()).toEqual([turn.turnId]);
  });
});

describe("website conservative per-attempt spend bound", () => {
  it("charges every HTTP attempt before transport and blocks admission at cap", async () => {
    const f = fixture(),
      result = await f.repository.ingestConversationEvent(f.event());
    if (result.status !== "turn_pending") throw Error();
    const lease = await f.repository.claimTurn(result.turnId),
      transport = vi.fn(async () => new Response("{}"));
    const budgeted = createBudgetedWebsiteFetch({
      repository: f.repository,
      lease: lease!,
      limits: { dailyHardStopMicrousd: 4000, totalHardStopMicrousd: 4000 },
      enabled: () => true,
      fetchImpl: transport,
    });
    const init = {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        max_output_tokens: 1200,
        input: "hello",
      }),
    };
    await budgeted("https://api.openai.com/v1/responses", init);
    await expect(
      budgeted("https://api.openai.com/v1/responses", init),
    ).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("rejects a changed model before any transport call", async () => {
    const f = fixture(),
      result = await f.repository.ingestConversationEvent(f.event());
    if (result.status !== "turn_pending") throw Error();
    const lease = await f.repository.claimTurn(result.turnId),
      transport = vi.fn();
    const budgeted = createBudgetedWebsiteFetch({
      repository: f.repository,
      lease: lease!,
      limits: { dailyHardStopMicrousd: 4000, totalHardStopMicrousd: 4000 },
      enabled: () => true,
      fetchImpl: transport,
    });
    await expect(
      budgeted("https://api.openai.com/v1/responses", {
        body: JSON.stringify({ model: "unapproved", max_output_tokens: 1200 }),
      }),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});
