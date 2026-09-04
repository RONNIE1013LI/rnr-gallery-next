import { describe, expect, it, vi } from "vitest";
import { createMetaRuntimeWorkerHandler, timingSafeCronSecretEqual } from "./route-handler";

function request(authorization?: string) {
  return new Request("https://rnrgallery.com/api/internal/reply-assistant/meta-runtime", {
    headers: authorization ? { authorization } : undefined,
  });
}

describe("Meta shared runtime worker", () => {
  it.each([undefined, "Basic secret", "Bearer", "Bearer wrong", "Bearer correct extra"])(
    "rejects invalid authorization before constructing runtime: %s",
    async (authorization) => {
      const createRuntime = vi.fn();
      const response = await createMetaRuntimeWorkerHandler({ secret: "correct", enabled: true, createRuntime })(request(authorization));
      expect(response.status).toBe(401);
      expect(createRuntime).not.toHaveBeenCalled();
    },
  );

  it("compares unequal secrets safely", () => {
    expect(() => timingSafeCronSecretEqual("short", "a-much-longer-secret")).not.toThrow();
    expect(timingSafeCronSecretEqual("short", "a-much-longer-secret")).toBe(false);
    expect(timingSafeCronSecretEqual("same", "same")).toBe(true);
  });

  it("returns OFF with no runtime or provider work when feature flags are false", async () => {
    const createRuntime = vi.fn();
    const response = await createMetaRuntimeWorkerHandler({ secret: "correct", enabled: false, createRuntime })(request("Bearer correct"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "off" });
    expect(createRuntime).not.toHaveBeenCalled();
  });

  it("claims and processes at most one durable backlog page", async () => {
    const backlogLease = { key: "a".repeat(64), controlRevision: 1, window: { from: "2026-09-03T00:00:00Z", to: "2026-09-04T00:00:00Z", maxConversations: 100 as const }, leaseToken: "lease", expiresAt: "2026-09-04T00:01:00Z" };
    const runtime = {
      controlIsOn: vi.fn(async () => true),
      store: { claimBacklog: vi.fn(async () => backlogLease) },
      backlog: { run: vi.fn(async () => ({ processed: 3, skipped: 2, stoppedBecauseOff: false })) },
    };
    const response = await createMetaRuntimeWorkerHandler({ secret: "correct", enabled: true, createRuntime: () => runtime })(request("Bearer correct"));
    expect(response.status).toBe(200);
    expect(runtime.store.claimBacklog).toHaveBeenCalledWith(60_000);
    expect(runtime.backlog.run).toHaveBeenCalledWith(backlogLease);
    expect(await response.json()).toEqual({ status: "processed", processed: 3, skipped: 2, stoppedBecauseOff: false });
  });

  it("fails closed without Graph/OpenAI work when store or runtime is unavailable", async () => {
    const response = await createMetaRuntimeWorkerHandler({
      secret: "correct",
      enabled: true,
      createRuntime: () => { throw new Error("redis unavailable"); },
    })(request("Bearer correct"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "RNR_AI_META_RUNTIME_UNAVAILABLE" } });
  });
});
