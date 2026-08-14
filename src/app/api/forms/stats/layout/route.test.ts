import { describe, expect, it, vi } from "vitest";
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
    const response = await route.PUT(new Request(`${origin}/api/forms/stats/layout`, {
      method: "PUT", headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ name: "Daily", widgets: [{ id: "w1", type: "number", metric: "job_count", title: "Orders" }] }),
    }));
    expect(response.status).toBe(200);
    expect(save).toHaveBeenCalledWith("manager-1", expect.objectContaining({ name: "Daily" }));
    expect(requirePermission).toHaveBeenCalledWith("manage_stats");
  });
});
