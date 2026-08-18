import { describe, expect, it, vi } from "vitest";
import { createTurnRecoveryHandler } from "./route-handler";

describe("turn recovery route", () => {
  it.each([null, "Bearer wrong", "Basic recovery-secret-at-least-32-bytes"])(
    "rejects invalid authorization without claiming turns: %s",
    async (authorization) => {
      const runOnce = vi.fn(async () => ({ claimed: 0, completed: 0, retried: 0, cancelled: 0 }));
      const handler = createTurnRecoveryHandler({
        secret: "recovery-secret-at-least-32-bytes",
        runOnce,
      });
      const response = await handler(new Request("https://example.test/internal", {
        headers: authorization ? { authorization } : undefined,
      }));

      expect(response.status).toBe(401);
      expect(runOnce).not.toHaveBeenCalled();
    },
  );

  it("runs a bounded batch and returns aggregate counts only", async () => {
    const runOnce = vi.fn()
      .mockResolvedValueOnce({ claimed: 1, completed: 1, retried: 0, cancelled: 0, privateValue: "secret" })
      .mockResolvedValueOnce({ claimed: 1, completed: 0, retried: 1, cancelled: 0, privateValue: "secret" })
      .mockResolvedValueOnce({ claimed: 0, completed: 0, retried: 0, cancelled: 0, privateValue: "secret" });
    const handler = createTurnRecoveryHandler({
      secret: "recovery-secret-at-least-32-bytes",
      runOnce,
      maxTurns: 10,
    });

    const response = await handler(new Request("https://example.test/internal", {
      headers: { authorization: "Bearer recovery-secret-at-least-32-bytes" },
    }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(body)).toEqual({ claimed: 2, completed: 1, retried: 1, cancelled: 0 });
    expect(body).not.toContain("secret");
    expect(runOnce).toHaveBeenCalledTimes(3);
  });
});
