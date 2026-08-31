import { describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { createPaymentProofCleanupRoute } from "./route-handler";

function request(authorization?: string) {
  return new Request("https://shop.example.test/api/internal/payment-proofs/cleanup", {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
  });
}

describe("POST /api/internal/payment-proofs/cleanup", () => {
  it("fails closed when the cron secret is unavailable", async () => {
    const run = vi.fn();
    const response = await createPaymentProofCleanupRoute({ secret: null, run })(
      request("Bearer supplied"),
    );
    expect(response.status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects an invalid bearer secret", async () => {
    const run = vi.fn();
    const response = await createPaymentProofCleanupRoute({
      secret: "correct",
      run,
      now: () => new Date("2026-09-01T04:05:00.000Z"),
    })(
      request("Bearer wrong"),
    );
    expect(response.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("returns bounded counts without leaking file metadata", async () => {
    const run = vi.fn().mockResolvedValue({
      examined: 4,
      deleted: 3,
      skipped: 0,
      failed: 1,
      storageKey: "must-not-leak.bin",
      originalName: "must-not-leak.jpg",
    });
    const response = await createPaymentProofCleanupRoute({
      secret: "correct",
      run,
      now: () => new Date("2026-09-01T04:05:00.000Z"),
    })(
      request("Bearer correct"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      examined: 4,
      deleted: 3,
      skipped: 0,
      failed: 1,
    });
    expect(run).toHaveBeenCalledWith(100);
  });

  it("skips the off-day before cleanup work", async () => {
    const run = vi.fn();
    const response = await createPaymentProofCleanupRoute({
      secret: "correct",
      run,
      now: () => new Date("2026-09-02T04:05:00.000Z"),
    })(request("Bearer correct"));

    expect(await response.json()).toEqual({ skipped: "two_day_cadence" });
    expect(run).not.toHaveBeenCalled();
  });

  it("exports the same authenticated handler for GET and POST", () => {
    expect(GET).toBe(POST);
  });
});
