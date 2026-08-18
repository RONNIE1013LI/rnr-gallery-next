import { describe, expect, it, vi } from "vitest";
import { createAdminProductionExportRoute } from "./route-handler";

describe("production CSV export route", () => {
  it("redacts finance for an exporter without the exact finance grant", async () => {
    const list = vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 5000, pageCount: 0 });
    const route = createAdminProductionExportRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "staff-1" },
        adminRole: "staff",
        adminPermissions: ["export_production_jobs"],
      }),
      list,
    });
    const response = await route.GET(new Request("https://shop.example.test/api/admin/jobs/export?urgent=yes"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ urgent: true, pageSize: 5000 }), { canViewFinance: false });
  });
});
