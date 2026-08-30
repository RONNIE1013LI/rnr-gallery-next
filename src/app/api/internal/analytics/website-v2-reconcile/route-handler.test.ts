import { describe, expect, it, vi } from "vitest";
import {
  createWebsiteAnalyticsV2ReconciliationDependencies,
  createWebsiteAnalyticsV2ReconciliationRoute,
  timingSafeAnalyticsCronSecretEqual,
} from "./route-handler";

const url = "https://rrgallery.co.nz/api/internal/analytics/website-v2-reconcile";

function request(authorization?: string) {
  return new Request(url, {
    headers: authorization ? { authorization } : undefined,
  });
}

describe("Website Analytics V2 reconciliation cron route", () => {
  it("does not construct a database dependency while V2 is disabled", () => {
    const databaseFactory = vi.fn();

    const dependencies = createWebsiteAnalyticsV2ReconciliationDependencies({
      WEBSITE_ANALYTICS_V2_ENABLED: "false",
      CRON_SECRET: "correct-secret",
    }, databaseFactory);

    expect(dependencies.v2Enabled).toBe(false);
    expect(databaseFactory).not.toHaveBeenCalled();
  });

  it("fails closed before work when V2 is disabled or configuration is missing", async () => {
    const run = vi.fn();
    const disabled = createWebsiteAnalyticsV2ReconciliationRoute({
      v2Enabled: false,
      secret: "correct-secret",
      run,
    });
    const missingSecret = createWebsiteAnalyticsV2ReconciliationRoute({
      v2Enabled: true,
      secret: null,
      run,
    });
    for (const response of [
      await disabled(request("Bearer correct-secret")),
      await missingSecret(request("Bearer correct-secret")),
    ]) {
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({
        error: { code: "WEBSITE_ANALYTICS_V2_RECONCILIATION_UNAVAILABLE" },
      });
    }
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    "Basic correct-secret",
    "Bearer",
    "Bearer wrong-secret",
    "Bearer correct-secret extra",
    "Bearer correct-secret,Bearer other",
  ])("rejects invalid authorization without running: %s", async (authorization) => {
    const run = vi.fn();
    const response = await createWebsiteAnalyticsV2ReconciliationRoute({
      v2Enabled: true,
      secret: "correct-secret",
      run,
    })(request(authorization));
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: { code: "UNAUTHORIZED" } });
    expect(run).not.toHaveBeenCalled();
  });

  it("compares unequal secret lengths in constant-time digest space", () => {
    expect(() => timingSafeAnalyticsCronSecretEqual("short", "a-much-longer-secret"))
      .not.toThrow();
    expect(timingSafeAnalyticsCronSecretEqual("short", "a-much-longer-secret")).toBe(false);
    expect(timingSafeAnalyticsCronSecretEqual("same", "same")).toBe(true);
  });

  it("returns only bounded aggregate counts and dates", async () => {
    const run = vi.fn().mockResolvedValue({
      repair: {
        totals: { scanned: 7, created: 2, wouldCreate: 0, unchanged: 4, skipped: 1, failed: 0 },
        sources: [{ source: "website_orders", cursor: { id: "private-order-id" } }],
      },
      aggregates: { rebuilt: 3, busy: 0, failed: 0 },
      recentWindow: { from: "2026-08-28", to: "2026-08-30" },
      customerEmail: "must-not-leak@example.test",
    });
    const response = await createWebsiteAnalyticsV2ReconciliationRoute({
      v2Enabled: true,
      secret: "correct-secret",
      run,
    })(request("Bearer correct-secret"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      repair: { scanned: 7, created: 2, unchanged: 4, skipped: 1, failed: 0 },
      aggregates: { rebuilt: 3, busy: 0, failed: 0 },
      recentWindow: { from: "2026-08-28", to: "2026-08-30" },
    });
    expect(JSON.stringify(body)).not.toContain("private-order-id");
    expect(JSON.stringify(body)).not.toContain("must-not-leak");
    expect(run).toHaveBeenCalledOnce();
  });

  it.each([
    { repairFailed: 1, aggregateFailed: 0 },
    { repairFailed: 0, aggregateFailed: 1 },
  ])("returns 503 when bounded reconciliation work reports a failure: %j", async ({
    repairFailed,
    aggregateFailed,
  }) => {
    const response = await createWebsiteAnalyticsV2ReconciliationRoute({
      v2Enabled: true,
      secret: "correct-secret",
      run: vi.fn().mockResolvedValue({
        repair: {
          totals: {
            scanned: 2,
            created: 0,
            unchanged: 1,
            skipped: 0,
            failed: repairFailed,
          },
          privateSourceId: "must-not-leak",
        },
        aggregates: { rebuilt: 1, busy: 0, failed: aggregateFailed },
        recentWindow: { from: "2026-08-28", to: "2026-08-30" },
      }),
    })(request("Bearer correct-secret"));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      error: { code: "WEBSITE_ANALYTICS_V2_RECONCILIATION_INCOMPLETE" },
      repair: { scanned: 2, created: 0, unchanged: 1, skipped: 0, failed: repairFailed },
      aggregates: { rebuilt: 1, busy: 0, failed: aggregateFailed },
      recentWindow: { from: "2026-08-28", to: "2026-08-30" },
    });
    expect(JSON.stringify(body)).not.toContain("must-not-leak");
  });

  it("isolates internal errors behind a safe no-store response", async () => {
    const response = await createWebsiteAnalyticsV2ReconciliationRoute({
      v2Enabled: true,
      secret: "correct-secret",
      run: vi.fn().mockRejectedValue(new Error("private source and database detail")),
    })(request("Bearer correct-secret"));
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: { code: "WEBSITE_ANALYTICS_V2_RECONCILIATION_FAILED" },
    });
  });
});
