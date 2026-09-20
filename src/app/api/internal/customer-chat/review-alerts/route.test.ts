import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  recover: vi.fn(), runtime: vi.fn(),
  websiteEnabled: true, websiteSharedBrainEnabled: true,
}));
vi.mock("@/server/customer-service/config", () => ({
  parseCustomerServiceConfig: () => ({
    enabled: true, websiteEnabled: state.websiteEnabled,
    turnRecoverySecret: "recovery-secret-at-least-32-bytes",
  }),
}));
vi.mock("@/server/rnr-ai/meta/config", () => ({
  parseRnrAiMetaConfig: () => ({ websiteSharedBrainEnabled: state.websiteSharedBrainEnabled }),
}));
vi.mock("@/server/rnr-ai/website/website-runtime", () => ({
  createProductionWebsiteReplyRuntime: state.runtime,
}));
vi.mock("@/server/customer-service/runtime", () => {
  throw Error("Legacy Neon runtime must never be imported");
});
import { GET, POST, maxDuration } from "./route";
beforeEach(() => {
  vi.clearAllMocks();
  state.websiteEnabled = true;
  state.websiteSharedBrainEnabled = true;
  state.recover.mockResolvedValue([]);
  state.runtime.mockReturnValue({ recoverReviewAlerts: state.recover });
});
describe("Production Redis-only recovery route", () => {
  it.each([GET, POST])("invokes the shared bounded recovery after authorization", async (handle) => {
    const start = Date.now();
    const response = await handle(new Request("https://example.test", {
      headers: { authorization: "Bearer recovery-secret-at-least-32-bytes" },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 0 });
    expect(state.runtime).toHaveBeenCalledOnce();
    expect(state.recover).toHaveBeenCalledExactlyOnceWith(5, expect.any(Number));
    expect(state.recover.mock.calls[0][1]).toBeGreaterThanOrEqual(start + 50_000);
    expect(maxDuration).toBe(60);
  });
  it("does not construct any runtime before authorization", async () => {
    expect((await GET(new Request("https://example.test"))).status).toBe(401);
    expect(state.runtime).not.toHaveBeenCalled();
  });
  it.each(["websiteEnabled", "websiteSharedBrainEnabled"] as const)("returns unavailable when %s is off", async (flag) => {
    state[flag] = false;
    expect((await GET(new Request("https://example.test"))).status).toBe(503);
    expect(state.runtime).not.toHaveBeenCalled();
  });
  it("returns 503 on shared recovery failure without legacy fallback", async () => {
    state.recover.mockRejectedValueOnce(Error("Redis unavailable"));
    const response = await GET(new Request("https://example.test", {
      headers: { authorization: "Bearer recovery-secret-at-least-32-bytes" },
    }));
    expect(response.status).toBe(503);
  });
});
