import { describe, expect, it, vi } from "vitest";
import { createFormsStatsRoute } from "./route-handler";

describe("forms stats route", () => {
  it("validates a metric and applies the operator's workbench scope", async () => {
    const access = {
      user: { id: "artist-1" }, formRole: "form_staff" as const,
      formProfile: { preset: "artist" as const, assignedOnly: true, permissions: { view_stats: true, view_finance: false } as never },
    };
    const query = vi.fn().mockResolvedValue({ metric: "job_count", value: 4 });
    const route = createFormsStatsRoute({ requirePermission: vi.fn().mockResolvedValue(access), query });
    const response = await route.GET(new Request("https://shop.example.test/api/forms/stats?metric=job_count&filter=urgent~equals~true"));
    expect(response.status).toBe(200);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ conditions: [expect.objectContaining({ field: "urgent" })] }),
      expect.objectContaining({ actorUserId: "artist-1", assignedOnly: true, canViewFinance: false }),
      "job_count",
    );
  });

  it("rejects finance metrics before repository execution without finance permission", async () => {
    const query = vi.fn();
    const route = createFormsStatsRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "artist-1" }, formRole: "form_staff",
        formProfile: { preset: "artist", assignedOnly: true, permissions: { view_stats: true, view_finance: false } },
      }),
      query,
    });
    expect((await route.GET(new Request("https://shop.example.test/api/forms/stats?metric=amount_paid_total"))).status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });
});
