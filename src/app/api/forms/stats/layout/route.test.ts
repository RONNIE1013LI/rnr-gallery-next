import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { buildFormAccessProfile } from "@/server/forms/forms-permissions";
import { createFormsStatsLayoutRoute } from "./route-handler";

const origin = "https://shop.example.test";
const managerProfile = buildFormAccessProfile("manager");
const access = {
  user: { id: "manager-1", email: "manager@example.test" }, formRole: "form_staff" as const,
  formProfile: {
    ...managerProfile,
    permissions: { ...managerProfile.permissions, manage_stats: true, view_finance: false },
  },
};
const financeAccess = {
  ...access,
  formProfile: { ...access.formProfile, permissions: { ...access.formProfile.permissions, view_finance: true } },
};

describe("forms stats layout route", () => {
  it("lists and saves only validated layouts for the current operator", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const save = vi.fn().mockResolvedValue({ id: "layout-1", name: "Daily", widgets: [] });
    const requirePermission = vi.fn().mockResolvedValue(access);
    const route = createFormsStatsLayoutRoute({ requirePermission, list, save, remove: vi.fn(), trustedOrigin: origin });
    expect((await route.GET(new Request(`${origin}/api/forms/stats/layout`))).status).toBe(200);
    expect(list).toHaveBeenCalledWith("manager-1");
    const response = await route.PUT(new Request(`${origin}/api/forms/stats/layout`, {
      method: "PUT", headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ name: "Daily", widgets: [{ id: "w1", type: "number", metric: "job_count", title: "Orders" }] }),
    }));
    expect(response.status).toBe(200);
    expect(save).toHaveBeenCalledWith("manager-1", expect.objectContaining({ name: "Daily" }));
    expect(requirePermission).toHaveBeenCalledWith("manage_stats");
  });

  it("sanitizes mixed stored layouts without leaking raw record or widget fields", async () => {
    const list = vi.fn().mockResolvedValue([{
      id: "layout-1",
      userId: "manager-1",
      name: "Daily",
      widgets: [
        { id: "orders", type: "number", metric: "job_count", title: "Orders" },
        { id: "unsafe", type: "sql", title: "Raw SQL", query: "select * from users", secret: "do not expose" },
      ],
      createdAt: "2026-08-23T00:00:00.000Z",
      privateMetadata: { secret: true },
    }]);
    const route = createFormsStatsLayoutRoute({
      requirePermission: vi.fn().mockResolvedValue(access), list, save: vi.fn(), remove: vi.fn(), trustedOrigin: origin,
    });

    const response = await route.GET(new Request(`${origin}/api/forms/stats/layout`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      layouts: [{
        id: "layout-1",
        name: "Daily",
        widgets: [{ id: "orders", type: "number", metric: "job_count", title: "Orders" }],
        skippedWidgetCount: 1,
        warning: "1 stale widget was skipped.",
      }],
    });
    expect(list).toHaveBeenCalledWith("manager-1");
  });

  it("omits stored finance widgets when the requester cannot view finance", async () => {
    const list = vi.fn().mockResolvedValue([{
      id: "layout-finance", name: "Finance", widgets: [
        { id: "orders", type: "number", metric: "job_count", title: "Orders" },
        { id: "paid", type: "number", metric: "amount_paid_total", title: "Paid" },
      ],
    }]);
    const route = createFormsStatsLayoutRoute({
      requirePermission: vi.fn().mockResolvedValue(access), list, save: vi.fn(), remove: vi.fn(), trustedOrigin: origin,
    });

    const response = await route.GET(new Request(`${origin}/api/forms/stats/layout`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      layouts: [{
        id: "layout-finance", name: "Finance",
        widgets: [{ id: "orders", type: "number", metric: "job_count", title: "Orders" }],
        skippedWidgetCount: 1,
        warning: "1 stale widget was skipped.",
      }],
    });
  });

  it("returns validated stored finance widgets when the requester can view finance", async () => {
    const list = vi.fn().mockResolvedValue([{
      id: "layout-finance", name: "Finance", widgets: [
        { id: "paid", type: "number", metric: "amount_paid_total", title: "Paid" },
      ],
    }]);
    const route = createFormsStatsLayoutRoute({
      requirePermission: vi.fn().mockResolvedValue(financeAccess), list, save: vi.fn(), remove: vi.fn(), trustedOrigin: origin,
    });

    const response = await route.GET(new Request(`${origin}/api/forms/stats/layout`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      layouts: [{
        id: "layout-finance", name: "Finance",
        widgets: [{ id: "paid", type: "number", metric: "amount_paid_total", title: "Paid" }],
        skippedWidgetCount: 0,
      }],
    });
  });

  it("retains an all-invalid stored layout with a warning and empty widgets", async () => {
    const list = vi.fn().mockResolvedValue([{
      id: "layout-legacy", name: "Legacy", widgets: [
        { id: "unsafe", type: "sql", title: "Raw SQL", query: "select *" },
      ],
    }]);
    const route = createFormsStatsLayoutRoute({
      requirePermission: vi.fn().mockResolvedValue(access), list, save: vi.fn(), remove: vi.fn(), trustedOrigin: origin,
    });

    const response = await route.GET(new Request(`${origin}/api/forms/stats/layout`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      layouts: [{
        id: "layout-legacy", name: "Legacy", widgets: [],
        skippedWidgetCount: 1,
        warning: "1 stale widget was skipped.",
      }],
    });
  });

  it("omits stored records with invalid layout envelopes", async () => {
    const validWidget = { type: "number", metric: "job_count", title: "Orders" };
    const list = vi.fn().mockResolvedValue([
      { id: "invalid-name", name: " ", widgets: [] },
      {
        id: "too-many", name: "Too many",
        widgets: Array.from({ length: 25 }, (_, index) => ({ id: `widget-${index}`, ...validWidget })),
      },
      {
        id: "too-large", name: "Too large",
        widgets: [{ id: "large-text", type: "text", title: "Notes", text: "x".repeat(50_000) }],
      },
      { id: "valid", name: "Valid", widgets: [{ id: "orders", ...validWidget }] },
    ]);
    const route = createFormsStatsLayoutRoute({
      requirePermission: vi.fn().mockResolvedValue(access), list, save: vi.fn(), remove: vi.fn(), trustedOrigin: origin,
    });

    const response = await route.GET(new Request(`${origin}/api/forms/stats/layout`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      layouts: [{
        id: "valid", name: "Valid",
        widgets: [{ id: "orders", type: "number", metric: "job_count", title: "Orders" }],
        skippedWidgetCount: 0,
      }],
    });
  });

  it("saves an allowlisted custom query widget for the current operator", async () => {
    const save = vi.fn().mockResolvedValue({ id: "layout-1", name: "Weekly", widgets: [] });
    const route = createFormsStatsLayoutRoute({
      requirePermission: vi.fn().mockResolvedValue(access), list: vi.fn(), save, remove: vi.fn(), trustedOrigin: origin,
    });

    const response = await route.PUT(new Request(`${origin}/api/forms/stats/layout`, {
      method: "PUT", headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        name: "Weekly",
        widgets: [{
          id: "weekly-orders", type: "line", title: "Weekly orders",
          query: { dimension: "submitted_at", timeUnit: "week", measure: "order_count", aggregation: "count", sort: "default" },
        }],
      }),
    }));

    expect(response.status).toBe(200);
    expect(save).toHaveBeenCalledWith("manager-1", expect.objectContaining({
      widgets: [expect.objectContaining({ query: expect.objectContaining({ dimension: "submitted_at", timeUnit: "week" }) })],
    }));
  });

  it("rejects finance layouts and untrusted origins before saving", async () => {
    const save = vi.fn();
    const route = createFormsStatsLayoutRoute({
      requirePermission: vi.fn().mockResolvedValue(access), list: vi.fn(), save, remove: vi.fn(), trustedOrigin: origin,
    });
    const financeLayout = JSON.stringify({
      name: "Finance",
      widgets: [{
        id: "paid-total", type: "number", title: "Paid",
        query: { measure: "amount_paid", aggregation: "sum", sort: "default" },
      }],
    });

    expect((await route.PUT(new Request(`${origin}/api/forms/stats/layout`, {
      method: "PUT", headers: { "Content-Type": "application/json", Origin: origin }, body: financeLayout,
    }))).status).toBe(422);
    expect((await route.PUT(new Request(`${origin}/api/forms/stats/layout`, {
      method: "PUT", headers: { "Content-Type": "application/json", Origin: "https://untrusted.example.test" }, body: financeLayout,
    }))).status).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });

  it("deletes the named layout for the current operator after trusted-origin and permission checks", async () => {
    const remove = vi.fn().mockResolvedValue(true);
    const requirePermission = vi.fn().mockResolvedValue(access);
    const route = createFormsStatsLayoutRoute({
      requirePermission, list: vi.fn(), save: vi.fn(), remove, trustedOrigin: origin,
    });

    const response = await route.DELETE(new Request(`${origin}/api/forms/stats/layout?name=Weekly`, {
      method: "DELETE", headers: { Origin: origin },
    }));

    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("manage_stats");
    expect(remove).toHaveBeenCalledWith("manager-1", "Weekly");
  });

  it.each([
    ["a missing name", ""],
    ["an invalid name", "?name=%20"],
    ["repeated names", "?name=Weekly&name=Finance"],
  ])("rejects delete requests with %s before removing a layout", async (_name, suffix) => {
    const remove = vi.fn();
    const route = createFormsStatsLayoutRoute({
      requirePermission: vi.fn().mockResolvedValue(access), list: vi.fn(), save: vi.fn(), remove, trustedOrigin: origin,
    });

    const response = await route.DELETE(new Request(`${origin}/api/forms/stats/layout${suffix}`, {
      method: "DELETE", headers: { Origin: origin },
    }));

    expect(response.status).toBe(422);
    expect(remove).not.toHaveBeenCalled();
  });

  it("rejects an untrusted delete request before removing a layout", async () => {
    const remove = vi.fn();
    const route = createFormsStatsLayoutRoute({
      requirePermission: vi.fn().mockResolvedValue(access), list: vi.fn(), save: vi.fn(), remove, trustedOrigin: origin,
    });

    const response = await route.DELETE(new Request(`${origin}/api/forms/stats/layout?name=Weekly`, {
      method: "DELETE", headers: { Origin: "https://untrusted.example.test" },
    }));

    expect(response.status).toBe(403);
    expect(remove).not.toHaveBeenCalled();
  });

  it("rejects an operator without manage_stats before removing a layout", async () => {
    const remove = vi.fn();
    const route = createFormsStatsLayoutRoute({
      requirePermission: vi.fn().mockRejectedValue(new HttpError("Forbidden", 403)),
      list: vi.fn(), save: vi.fn(), remove, trustedOrigin: origin,
    });

    const response = await route.DELETE(new Request(`${origin}/api/forms/stats/layout?name=Weekly`, {
      method: "DELETE", headers: { Origin: origin },
    }));

    expect(response.status).toBe(403);
    expect(remove).not.toHaveBeenCalled();
  });
});
