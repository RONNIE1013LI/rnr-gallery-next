import { describe, expect, it, vi } from "vitest";
import {
  createWebsiteReplyRuntime,
  createBudgetedWebsiteFetch,
  createWebsiteAiControlGate,
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
  it("opens a manually answerable review without generation when master gate is off", async () => {
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
      status: "review",
    });
    expect(generate).not.toHaveBeenCalled();
    expect(await f.repository.pendingTurnIds()).toEqual([]);
    const item = (await f.repository.listQueue(5)).items[0];
    expect(item.websiteReview?.reason).toBe("unresolved");
    expect(
      await f.repository.answerWebsiteReview({
        reviewSelector: item.websiteReview!.selector!,
        text: "Our team can help.",
        actorUserId: "synthetic-staff",
        now: new Date(f.now()),
      }),
    ).toEqual({ status: "sent" });
    expect(
      (await f.repository.listQueue(5)).items[0].timeline.at(-1)?.role,
    ).toBe("staff");
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

describe("website per-attempt usage reconciliation", () => {
  it("refunds unused allowance from complete response usage and leaves original response readable", async () => {
    const f = fixture(),
      turn = await f.repository.ingestConversationEvent(f.event());
    if (turn.status !== "turn_pending") throw Error();
    const lease = (await f.repository.claimTurn(turn.turnId))!;
    const payload = {
      model: "gpt-5.6-luna",
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 20, cache_write_tokens: 30 },
        output_tokens: 10,
      },
    };
    const transport = vi.fn(async () => Response.json(payload));
    const budgeted = createBudgetedWebsiteFetch({
      repository: f.repository,
      lease,
      limits: { dailyHardStopMicrousd: 3000, totalHardStopMicrousd: 3000 },
      enabled: () => true,
      fetchImpl: transport,
    });
    const init = {
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        max_output_tokens: 1200,
        input: "hello",
      }),
    };
    const response = await budgeted(
      "https://api.openai.com/v1/responses",
      init,
    );
    expect(await response.json()).toEqual(payload);
    await budgeted("https://api.openai.com/v1/responses", init);
    expect(transport).toHaveBeenCalledTimes(2);
    // 50 uncached +20 cached +30 cache writes +10 output =30 estimated microusd/call.
    expect(
      await f.repository.reserveProviderBudget(
        lease,
        { dailyHardStopMicrousd: 3000, totalHardStopMicrousd: 3000 },
        2940,
        "remaining",
      ),
    ).toBe(true);
    expect(
      await f.repository.reserveProviderBudget(
        lease,
        { dailyHardStopMicrousd: 3000, totalHardStopMicrousd: 3000 },
        1,
        "overflow",
      ),
    ).toBe(false);
  });
  it.each(["gpt-5.6-luna", "gpt-5.6-luna-2026-08-01"])(
    "reconciles ordinary fixture usage conservatively for %s",
    async (model) => {
      const f = fixture(),
        turn = await f.repository.ingestConversationEvent(f.event());
      if (turn.status !== "turn_pending") throw Error();
      const lease = (await f.repository.claimTurn(turn.turnId))!;
      const transport = vi.fn(async () =>
        Response.json({
          model,
          usage: {
            input_tokens: 100,
            input_tokens_details: { cached_tokens: 10 },
            output_tokens: 20,
          },
        }),
      );
      const budgeted = createBudgetedWebsiteFetch({
        repository: f.repository,
        lease,
        limits: { dailyHardStopMicrousd: 3000, totalHardStopMicrousd: 3000 },
        enabled: () => true,
        fetchImpl: transport,
      });
      const init = {
        body: JSON.stringify({
          model: "gpt-5.6-luna",
          max_output_tokens: 1200,
        }),
      };
      await budgeted("https://api.openai.com/v1/responses", init);
      await budgeted("https://api.openai.com/v1/responses", init);
      expect(transport).toHaveBeenCalledTimes(2);
      expect(
        await f.repository.reserveProviderBudget(
          lease,
          { dailyHardStopMicrousd: 3000, totalHardStopMicrousd: 3000 },
          2906,
          "remaining",
        ),
      ).toBe(true);
      expect(
        await f.repository.reserveProviderBudget(
          lease,
          { dailyHardStopMicrousd: 3000, totalHardStopMicrousd: 3000 },
          1,
          "overflow",
        ),
      ).toBe(false);
    },
  );
});

describe("website reconciliation outage", () => {
  it("returns the original response and retains allowance if Redis settlement fails", async () => {
    const f = fixture(),
      turn = await f.repository.ingestConversationEvent(f.event());
    if (turn.status !== "turn_pending") throw Error();
    const lease = (await f.repository.claimTurn(turn.turnId))!;
    vi.spyOn(f.repository, "settleProviderCallBudget").mockRejectedValue(
      Error("synthetic Redis outage"),
    );
    const payload = {
      model: "gpt-5.6-luna",
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 20, cache_write_tokens: 30 },
        output_tokens: 10,
      },
    };
    const transport = vi.fn(async () => Response.json(payload));
    const budgeted = createBudgetedWebsiteFetch({
      repository: f.repository,
      lease,
      limits: { dailyHardStopMicrousd: 3000, totalHardStopMicrousd: 3000 },
      enabled: () => true,
      fetchImpl: transport,
    });
    const init = {
      body: JSON.stringify({ model: "gpt-5.6-luna", max_output_tokens: 1200 }),
    };
    expect(
      await (
        await budgeted("https://api.openai.com/v1/responses", init)
      ).json(),
    ).toEqual(payload);
    await expect(
      budgeted("https://api.openai.com/v1/responses", init),
    ).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe("website incomplete usage keeps reservation", () => {
  it.each([
    {
      model: "gpt-5.6-luna",
      usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 10 } },
    },
    {
      model: "gpt-5.6-luna",
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 10, cache_write_tokens: -1 },
        output_tokens: 20,
      },
    },
    {
      model: "different-model",
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 10 },
        output_tokens: 20,
      },
    },
  ])(
    "keeps the allowance for missing/invalid usage or unknown model",
    async (payload) => {
      const f = fixture(),
        turn = await f.repository.ingestConversationEvent(f.event());
      if (turn.status !== "turn_pending") throw Error();
      const lease = (await f.repository.claimTurn(turn.turnId))!;
      const transport = vi.fn(async () => Response.json(payload));
      const budgeted = createBudgetedWebsiteFetch({
        repository: f.repository,
        lease,
        limits: { dailyHardStopMicrousd: 3000, totalHardStopMicrousd: 3000 },
        enabled: () => true,
        fetchImpl: transport,
      });
      const init = {
        body: JSON.stringify({
          model: "gpt-5.6-luna",
          max_output_tokens: 1200,
        }),
      };
      await budgeted("https://api.openai.com/v1/responses", init);
      await expect(
        budgeted("https://api.openai.com/v1/responses", init),
      ).rejects.toThrow();
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
});

describe("website shared AI Control parity", () => {
  it("awaits the control gate and keeps OFF messages manually answerable", async () => {
    const f = fixture(),
      generate = vi.fn();
    const runtime = createWebsiteReplyRuntime({
      repository: f.repository,
      brain: { generate },
      enabled: async () => false,
    });
    const turn = await f.repository.ingestConversationEvent(f.event());
    if (turn.status !== "turn_pending") throw Error();
    expect(await runtime.processTurn(turn.turnId)).toEqual({
      status: "review",
    });
    expect(generate).not.toHaveBeenCalled();
    expect(
      (await f.repository.listQueue(5)).items[0].websiteReview?.reason,
    ).toBe("unresolved");
  });
  it("does not publish when control turns OFF while generation is running", async () => {
    const f = fixture();
    let on = true;
    const runtime = createWebsiteReplyRuntime({
      repository: f.repository,
      brain: {
        generate: async () => {
          on = false;
          return { decision };
        },
      },
      enabled: async () => on,
    });
    const turn = await f.repository.ingestConversationEvent(f.event());
    if (turn.status !== "turn_pending") throw Error();
    expect(await runtime.processTurn(turn.turnId)).toEqual({
      status: "review",
    });
    expect((await f.repository.listQueue(5)).items[0].timeline).toHaveLength(1);
  });
});

describe("website shared control evaluator", () => {
  const now = new Date("2026-09-06T20:00:00.000Z"),
    env = {
      RNR_AI_MASTER_ENABLED: "true",
      RNR_WEBSITE_SHARED_BRAIN_ENABLED: "true",
    };
  it.each([
    { mode: "ON", override: null, periods: [], expected: true },
    { mode: "OFF", override: null, periods: [], expected: false },
    {
      mode: "ON",
      override: {
        state: "OFF",
        actorUserId: "synthetic-admin",
        expiresAt: "2026-09-07T00:00:00.000Z",
      },
      periods: [],
      expected: false,
    },
    {
      mode: "OFF",
      override: {
        state: "ON",
        actorUserId: "synthetic-admin",
        expiresAt: "2026-09-07T00:00:00.000Z",
      },
      periods: [],
      expected: true,
    },
    {
      mode: "SCHEDULE",
      override: null,
      periods: [{ day: 1, start: "07:00", end: "09:00" }],
      expected: true,
    },
    {
      mode: "SCHEDULE",
      override: null,
      periods: [{ day: 1, start: "09:00", end: "17:00" }],
      expected: false,
    },
  ] as const)(
    "uses the shared mode schedule and override",
    async ({ expected, ...config }) => {
      const gate = createWebsiteAiControlGate({
        env,
        websiteEnabled: true,
        now: () => now,
        store: {
          readControl: async () => ({
            config: { revision: 1, timezone: "Pacific/Auckland", ...config },
            readAt: now.toISOString(),
          }),
        },
      });
      expect(await gate()).toBe(expected);
    },
  );
  it("fails closed if Redis control cannot be read", async () => {
    const gate = createWebsiteAiControlGate({
      env,
      websiteEnabled: true,
      store: {
        readControl: async () => {
          throw Error("synthetic outage");
        },
      },
    });
    expect(await gate()).toBe(false);
  });
  it("checks async control before each HTTP attempt", async () => {
    const f = fixture(),
      turn = await f.repository.ingestConversationEvent(f.event());
    if (turn.status !== "turn_pending") throw Error();
    const lease = (await f.repository.claimTurn(turn.turnId))!,
      transport = vi.fn();
    const budgeted = createBudgetedWebsiteFetch({
      repository: f.repository,
      lease,
      limits: { dailyHardStopMicrousd: 5000, totalHardStopMicrousd: 5000 },
      enabled: async () => false,
      fetchImpl: transport,
    });
    await expect(
      budgeted("https://api.openai.com/v1/responses", {
        body: JSON.stringify({
          model: "gpt-5.6-luna",
          max_output_tokens: 1200,
        }),
      }),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});

it("refunds a reservation when control turns OFF before HTTP starts", async () => {
  const f = fixture(),
    turn = await f.repository.ingestConversationEvent(f.event());
  if (turn.status !== "turn_pending") throw Error();
  const lease = (await f.repository.claimTurn(turn.turnId))!,
    transport = vi.fn(),
    enabled = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
  const limits = { dailyHardStopMicrousd: 3000, totalHardStopMicrousd: 3000 },
    budgeted = createBudgetedWebsiteFetch({
      repository: f.repository,
      lease,
      limits,
      enabled,
      fetchImpl: transport,
    });
  await expect(
    budgeted("https://api.openai.com/v1/responses", {
      body: JSON.stringify({ model: "gpt-5.6-luna", max_output_tokens: 1200 }),
    }),
  ).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
  expect(
    await f.repository.reserveProviderBudget(
      lease,
      limits,
      3000,
      "remaining-after-kill",
    ),
  ).toBe(true);
});
