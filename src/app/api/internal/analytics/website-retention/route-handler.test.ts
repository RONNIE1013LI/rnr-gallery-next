import { describe, expect, it, vi } from "vitest";
import { createWebsiteAnalyticsRetentionRoute } from "./route-handler";

function request(token?: string) {
  return new Request("https://rrgallery.co.nz/api/internal/analytics/website-retention", {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
}

describe("website analytics retention route", () => {
  it("requires the server-only Cron secret", async () => {
    const run = vi.fn();
    expect((await createWebsiteAnalyticsRetentionRoute({ secret: null, run })(request())).status)
      .toBe(503);
    expect((await createWebsiteAnalyticsRetentionRoute({ secret: "x".repeat(32), run })(request("wrong"))).status)
      .toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("returns only aggregate cleanup counts", async () => {
    const run = vi.fn().mockResolvedValue({ deletedSessions: 9, privateData: "hidden" });
    const secret = "x".repeat(32);
    const response = await createWebsiteAnalyticsRetentionRoute({ secret, run })(request(secret));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deletedSessions: 9 });
  });
});
