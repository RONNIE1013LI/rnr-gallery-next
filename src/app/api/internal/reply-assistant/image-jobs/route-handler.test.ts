import { describe, expect, it, vi } from "vitest";
import { createImageJobRecoveryHandler } from "./route-handler";

describe("image job recovery route", () => {
  it.each([null, "Bearer wrong-secret", "Basic recovery-secret-at-least-32-bytes"])(
    "rejects invalid authorization without touching jobs: %s",
    async (authorization) => {
      const runOnce = vi.fn(async () => ({ claimed: 0, completed: 0, humanReviewRequired: 0 }));
      const handler = createImageJobRecoveryHandler({
        secret: "recovery-secret-at-least-32-bytes",
        runOnce,
      });
      const headers = authorization ? { authorization } : undefined;
      const response = await handler(new Request("https://example.test/internal", { method: "POST", headers }));
      expect(response.status).toBe(401);
      expect(runOnce).not.toHaveBeenCalled();
    },
  );

  it("runs a bounded recovery batch and exposes counts only", async () => {
    const privateValues = "private-url ciphertext storage-key customer-id";
    const runOnce = vi.fn()
      .mockResolvedValueOnce({ claimed: 1, completed: 1, humanReviewRequired: 0, privateValues })
      .mockResolvedValueOnce({ claimed: 1, completed: 0, humanReviewRequired: 1, privateValues })
      .mockResolvedValueOnce({ claimed: 0, completed: 0, humanReviewRequired: 0, privateValues });
    const handler = createImageJobRecoveryHandler({
      secret: "recovery-secret-at-least-32-bytes",
      runOnce,
      maxJobs: 10,
    });

    const response = await handler(new Request("https://example.test/internal", {
      method: "POST",
      headers: { authorization: "Bearer recovery-secret-at-least-32-bytes" },
    }));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ claimed: 2, completed: 1, humanReviewRequired: 1 });
    expect(body).not.toContain(privateValues);
    expect(runOnce).toHaveBeenCalledTimes(3);
  });

  it("runs only one durable stage by default", async () => {
    const runOnce = vi.fn(async () => ({ claimed: 1, completed: 0, humanReviewRequired: 0 }));
    const handler = createImageJobRecoveryHandler({
      secret: "recovery-secret-at-least-32-bytes",
      runOnce,
    });

    const response = await handler(new Request("https://example.test/internal", {
      method: "POST",
      headers: { authorization: "Bearer recovery-secret-at-least-32-bytes" },
    }));

    expect(response.status).toBe(200);
    expect(runOnce).toHaveBeenCalledOnce();
  });

  it("stops at the configured batch ceiling", async () => {
    const runOnce = vi.fn(async () => ({ claimed: 1, completed: 0, humanReviewRequired: 0 }));
    const handler = createImageJobRecoveryHandler({
      secret: "recovery-secret-at-least-32-bytes",
      runOnce,
      maxJobs: 2,
    });
    const response = await handler(new Request("https://example.test/internal", {
      method: "POST",
      headers: { authorization: "Bearer recovery-secret-at-least-32-bytes" },
    }));
    expect(response.status).toBe(200);
    expect(runOnce).toHaveBeenCalledTimes(2);
  });
});
