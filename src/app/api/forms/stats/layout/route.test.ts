import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { createFormsStatsLayoutRoute } from "./route-handler";

const origin = "https://shop.example.test";
const access = {
  user: { id: "manager-1", email: "manager@example.test" }, formRole: "form_staff" as const,
  formProfile: { preset: "manager" as const, assignedOnly: false, permissions: { view_stats: true, manage_stats: true, view_finance: false } as never },
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
