import { describe, expect, it, vi } from "vitest";
import compiledKnowledge from "./knowledge/compiled-knowledge.json";
import { CustomerServiceEngine } from "./engine";
import type { CustomerServiceRepository } from "./repositories/customer-service-repository";

function repositoryFor(body: string) {
  return {
    loadDraftInput: vi.fn(async () => ({
      current: { id: "message-1", body, channel: "facebook" as const },
      context: [body],
    })),
    createGateBlockedAttempt: vi.fn(async () => "attempt-blocked"),
    reserveProviderAttempt: vi.fn(async () => ({ status: "reserved" as const, attemptId: "attempt-1" })),
    completeProviderAttempt: vi.fn(async () => undefined),
  } as unknown as CustomerServiceRepository;
}

function provider(text = "Please send the original photo and we can assess it for you 😊") {
  return {
    providerKind: "mock" as const,
    model: "mock",
    generate: vi.fn(async () => ({
      text,
      provider: "mock" as const,
      model: "mock",
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      estimatedCostMicrousd: 0,
      latencyMs: 1,
    })),
  };
}

function engine(body: string, reply?: string) {
  const repository = repositoryFor(body);
  const aiProvider = provider(reply);
  return {
    repository,
    aiProvider,
    engine: new CustomerServiceEngine({
      repository,
      provider: aiProvider,
      knowledge: compiledKnowledge,
      budget: { reservationMicrousd: 1_000, dailyHardStopMicrousd: 1_000_000, totalHardStopMicrousd: 5_000_000 },
    }),
  };
}

describe("CustomerServiceEngine", () => {
  it.each([
    ["I want a refund", "gate_blocked"],
    ["How much is an A1 canvas today?", "realtime_required"],
    ["How many free revisions do I get?", "gate_blocked"],
  ])("blocks before model invocation: %s", async (message, expected) => {
    const setup = engine(message);
    await expect(setup.engine.generateDraft({ messageId: "message-1", trigger: "manual_generate" }))
      .resolves.toMatchObject({ status: expected });
    expect(setup.aiProvider.generate).not.toHaveBeenCalled();
    expect(setup.repository.reserveProviderAttempt).not.toHaveBeenCalled();
  });

  it("generates, validates and persists one allowed draft", async () => {
    const setup = engine("Can you use my blurry original photo?");
    await expect(setup.engine.generateDraft({ messageId: "message-1", trigger: "manual_generate" }))
      .resolves.toEqual({ status: "draft_ready", attemptId: "attempt-1" });
    expect(setup.aiProvider.generate).toHaveBeenCalledTimes(1);
    expect(setup.repository.completeProviderAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: "draft_ready",
      draftText: "Please send the original photo and we can assess it for you 😊",
    }));
  });

  it("stores only a hash when output validation blocks", async () => {
    const setup = engine("Can you use my blurry original photo?", "We guarantee it will print perfectly.");
    await expect(setup.engine.generateDraft({ messageId: "message-1", trigger: "manual_generate" }))
      .resolves.toEqual({ status: "output_blocked", attemptId: "attempt-1" });
    expect(setup.repository.completeProviderAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: "output_blocked",
      draftText: undefined,
      rejectedOutputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });

  it("returns a safe provider error and persists no raw error", async () => {
    const setup = engine("Can you use my blurry original photo?");
    setup.aiProvider.generate.mockRejectedValueOnce(new Error("private provider body"));
    await expect(setup.engine.generateDraft({ messageId: "message-1", trigger: "manual_generate" }))
      .resolves.toEqual({ status: "provider_error", attemptId: "attempt-1" });
    expect(setup.repository.completeProviderAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: "provider_error",
      providerErrorCode: "provider_request_failed",
    }));
  });
});
