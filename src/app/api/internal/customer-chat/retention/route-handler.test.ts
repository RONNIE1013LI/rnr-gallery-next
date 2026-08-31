import { describe, expect, it, vi } from "vitest";
import { createWebsiteRetentionCronHandler } from "./route-handler";

describe("website retention cron route", () => {
  it.each([null, "Bearer wrong", "Basic retention-secret-at-least-32-bytes"])(
    "rejects invalid authorization without touching retained data: %s",
    async (authorization) => {
      const run = vi.fn(async () => ({
        sessionsExpired: 0,
        rateBucketsDeleted: 0,
        rateBlockEventsDeleted: 0,
        reviewLinksExpired: 0,
        conversationsAnonymized: 0,
      }));
      const handler = createWebsiteRetentionCronHandler({
        secret: "retention-secret-at-least-32-bytes",
        run,
      });

      const response = await handler(new Request("https://example.test/internal", {
        headers: authorization ? { authorization } : undefined,
      }));

      expect(response.status).toBe(401);
      expect(run).not.toHaveBeenCalled();
    },
  );

  it("runs one bounded batch and returns aggregate counts only", async () => {
    const run = vi.fn(async () => ({
      sessionsExpired: 3,
      rateBucketsDeleted: 5,
      rateBlockEventsDeleted: 2,
      reviewLinksExpired: 1,
      conversationsAnonymized: 4,
      privateValue: "customer@example.test",
    }));
    const handler = createWebsiteRetentionCronHandler({
      secret: "retention-secret-at-least-32-bytes",
      run,
      limit: 17,
      now: () => new Date("2026-08-22T00:00:00.000Z"),
    });

    const response = await handler(new Request("https://example.test/internal", {
      headers: { authorization: "Bearer retention-secret-at-least-32-bytes" },
    }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(body)).toEqual({
      sessionsExpired: 3,
      rateBucketsDeleted: 5,
      rateBlockEventsDeleted: 2,
      reviewLinksExpired: 1,
      conversationsAnonymized: 4,
    });
    expect(body).not.toContain("customer@example.test");
    expect(run).toHaveBeenCalledWith({
      now: new Date("2026-08-22T00:00:00.000Z"),
      limit: 17,
    });
  });

  it("skips the off-day before invoking the retention repository", async () => {
    const run = vi.fn();
    const handler = createWebsiteRetentionCronHandler({
      secret: "retention-secret-at-least-32-bytes",
      run,
      now: () => new Date("2026-09-02T04:02:00.000Z"),
    });

    const response = await handler(new Request("https://example.test/internal", {
      headers: { authorization: "Bearer retention-secret-at-least-32-bytes" },
    }));

    expect(await response.json()).toEqual({ skipped: "two_day_cadence" });
    expect(run).not.toHaveBeenCalled();
  });
});
