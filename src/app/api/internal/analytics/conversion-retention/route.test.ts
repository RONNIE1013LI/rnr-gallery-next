import { describe, expect, it, vi } from "vitest";
import { createConversionRetentionCronRoute } from "./route-handler";

function request(authorization?: string) {
  return new Request("https://shop.example.test/api/internal/analytics/conversion-retention", {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
  });
}

describe("conversion retention cron route", () => {
  it("requires authenticated server-only access", async () => {
    const run = vi.fn();
    const missing = await createConversionRetentionCronRoute({ secret: null, run })(request());
    const wrong = await createConversionRetentionCronRoute({ secret: "secret", run })(
      request("Bearer wrong"),
    );
    expect(missing.status).toBe(503);
    expect(wrong.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the idempotent snapshot redaction without exposing row data", async () => {
    const run = vi.fn().mockResolvedValue(4);
    const response = await createConversionRetentionCronRoute({
      secret: "secret",
      run,
      now: () => new Date("2026-09-01T04:00:00.000Z"),
    })(
      request("Bearer secret"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ redacted: 4 });
    expect(run).toHaveBeenCalledOnce();
  });

  it("fails safely when the database is unavailable", async () => {
    const run = vi.fn().mockRejectedValue(new Error("private database error"));
    const response = await createConversionRetentionCronRoute({
      secret: "secret",
      run,
      now: () => new Date("2026-09-01T04:00:00.000Z"),
    })(
      request("Bearer secret"),
    );
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private database error");
  });

  it("returns a successful cadence skip without running retention", async () => {
    const run = vi.fn();
    const response = await createConversionRetentionCronRoute({
      secret: "secret",
      run,
      now: () => new Date("2026-09-02T04:00:00.000Z"),
    })(request("Bearer secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ skipped: "two_day_cadence" });
    expect(run).not.toHaveBeenCalled();
  });
});
