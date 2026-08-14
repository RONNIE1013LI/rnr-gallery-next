import { describe, expect, it, vi } from "vitest";
import { createProductionSavedViewsRoute } from "./route-handler";

describe("production saved views route", () => {
  it("creates a same-origin view for the current user", async () => {
    const create = vi.fn().mockResolvedValue({ result: "created", view: { id: "view-1" } });
    const route = createProductionSavedViewsRoute({
      requirePermission: vi.fn().mockResolvedValue({ user: { id: "user-1", email: "staff@example.com" }, adminRole: "staff" }),
      list: vi.fn(), create, trustedOrigin: "https://shop.example.test",
    });
    const response = await route.POST(new Request("https://shop.example.test/api/admin/jobs/views", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "https://shop.example.test" },
      body: JSON.stringify({ name: "Urgent", queryString: "urgent=yes" }),
    }));
    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith({ userId: "user-1", email: "staff@example.com" }, { name: "Urgent", queryString: "urgent=yes" });
  });
});
