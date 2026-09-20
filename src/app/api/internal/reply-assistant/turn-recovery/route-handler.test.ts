import { describe, expect, it, vi } from "vitest";
import { createTurnRecoveryHandler } from "./route-handler";

const secret = "recovery-secret-at-least-32-bytes";
const request = (authorization: string | null = `Bearer ${secret}`) =>
  new Request("https://example.test/internal", {
    headers: authorization ? { authorization } : undefined,
  });

describe("shared Redis recovery handler", () => {
  it.each([null, "Bearer wrong", `Basic ${secret}`])("rejects unauthorized work: %s", async (authorization) => {
    const runShared = vi.fn(async () => []);
    const response = await createTurnRecoveryHandler({ secret, runShared })(request(authorization));
    expect(response.status).toBe(401);
    expect(runShared).not.toHaveBeenCalled();
  });

  it("runs shared recovery once with a bounded deadline and returns only a safe count", async () => {
    const runShared = vi.fn(async () => [{ privateValue: "private" }, { status: "review" }]);
    const response = await createTurnRecoveryHandler({ secret, runShared, now: () => 1000 })(request());
    expect(runShared).toHaveBeenCalledExactlyOnceWith(51_000);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 2 });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("handles empty Redis queues successfully", async () => {
    const response = await createTurnRecoveryHandler({ secret, runShared: async () => [] })(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 0 });
  });

  it("reports Redis failure without exposing private errors or using a fallback", async () => {
    const runShared = vi.fn(async () => { throw Error("private connection details"); });
    const response = await createTurnRecoveryHandler({ secret, runShared })(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "SHARED_RECOVERY_UNAVAILABLE" } });
    expect(runShared).toHaveBeenCalledOnce();
  });

  it("reports a missed deadline truthfully", async () => {
    let now = 0;
    const response = await createTurnRecoveryHandler({
      secret, now: () => now,
      runShared: async () => { now = 50_000; return []; },
    })(request());
    expect(response.status).toBe(503);
  });
});
