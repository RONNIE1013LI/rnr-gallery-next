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

  it("executes an allowlisted custom statistic with the operator's workbench scope", async () => {
    const access = {
      user: { id: "artist-1" }, formRole: "form_staff" as const,
      formProfile: { preset: "artist" as const, assignedOnly: true, permissions: { view_stats: true, view_finance: false } as never },
    };
    const query = vi.fn().mockResolvedValue({
      query: { dimension: "submitted_at", timeUnit: "week", measure: "order_count", aggregation: "count", sort: "default" },
      rows: [],
    });
    const route = createFormsStatsRoute({ requirePermission: vi.fn().mockResolvedValue(access), query });

    const response = await route.GET(new Request(
      "https://shop.example.test/api/forms/stats?dimension=submitted_at&timeUnit=week&measure=order_count&aggregation=count&sort=default&filter=urgent~equals~true",
    ));

    expect(response.status).toBe(200);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ conditions: [expect.objectContaining({ field: "urgent" })] }),
      expect.objectContaining({ actorUserId: "artist-1", assignedOnly: true, canViewFinance: false }),
      expect.objectContaining({ dimension: "submitted_at", timeUnit: "week", measure: "order_count", aggregation: "count", sort: "default" }),
    );
  });

  it.each([
    ["unknown fields", "customer_email=customer%40example.test&measure=order_count&aggregation=count&sort=default"],
    ["sensitive dimensions", "dimension=customer_email&measure=order_count&aggregation=count&sort=default"],
    ["invalid combinations", "dimension=delivery_method&timeUnit=month&measure=order_count&aggregation=count&sort=default"],
    ["mixed legacy and custom requests", "metric=job_count&measure=order_count&aggregation=count&sort=default"],
    ["legacy metrics mixed with custom sorting", "metric=job_count&sort=default"],
  ])("rejects %s before repository execution", async (_name, parameters) => {
    const query = vi.fn();
    const route = createFormsStatsRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "artist-1" }, formRole: "form_staff",
        formProfile: { preset: "artist", assignedOnly: true, permissions: { view_stats: true, view_finance: false } },
      }),
      query,
    });

    const response = await route.GET(new Request(`https://shop.example.test/api/forms/stats?${parameters}`));

    expect(response.status).toBe(422);
    expect(query).not.toHaveBeenCalled();
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

  it.each([
    ["finance measures", "measure=amount_paid&aggregation=sum&sort=default"],
    ["finance dimensions", "dimension=bank_recon&measure=order_count&aggregation=count&sort=default"],
  ])("rejects %s before repository execution without finance permission", async (_name, parameters) => {
    const query = vi.fn();
    const route = createFormsStatsRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "artist-1" }, formRole: "form_staff",
        formProfile: { preset: "artist", assignedOnly: true, permissions: { view_stats: true, view_finance: false } },
      }),
      query,
    });

    const response = await route.GET(new Request(`https://shop.example.test/api/forms/stats?${parameters}`));

    expect(response.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });
});
