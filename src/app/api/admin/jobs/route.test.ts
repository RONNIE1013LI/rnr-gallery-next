import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { createAdminJobsRoute } from "./route-handler";

const origin = "http://localhost:3000";

function postRequest(body: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/admin/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: requestOrigin,
      "Sec-Fetch-Site": requestOrigin === origin ? "same-origin" : "cross-site",
    },
    body: JSON.stringify(body),
  });
}

describe("admin production jobs route", () => {
  it("authorizes before listing production data", async () => {
    const list = vi.fn();
    const route = createAdminJobsRoute({
      requirePermission: vi.fn().mockRejectedValue(new HttpError("Forbidden", 403)),
      list,
      createManual: vi.fn(),
      trustedOrigin: origin,
    });
    const response = await route.GET(new Request(`${origin}/api/admin/jobs?q=ana`));
    expect(response.status).toBe(403);
    expect(list).not.toHaveBeenCalled();
  });

  it("parses list filters and redacts finance for staff", async () => {
    const list = vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25, pageCount: 0 });
    const route = createAdminJobsRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "staff-1", email: "staff@example.test" },
        adminRole: "staff",
        adminPermissions: ["view_production_jobs"],
      }),
      list,
      createManual: vi.fn(),
      trustedOrigin: origin,
    });
    const response = await route.GET(new Request(
      `${origin}/api/admin/jobs?q=Ana&source=manual&urgent=yes`,
    ));
    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({
      query: "Ana",
      source: "manual",
      urgent: true,
    }), { canViewFinance: false });
  });

  it("creates a same-origin manual job with authenticated finance capability", async () => {
    const createManual = vi.fn().mockResolvedValue({
      result: "created",
      job: {
        id: "job-1",
        jobNumber: "RRM-2026-ONE",
        requestDigest: "digest",
        updatedAt: new Date("2026-08-17T00:00:00.000Z"),
      },
    });
    const route = createAdminJobsRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "admin-1", email: "owner@example.test" },
        adminRole: "admin",
        adminPermissions: [],
      }),
      list: vi.fn(),
      createManual,
      trustedOrigin: origin,
    });
    const body = { idempotencyKey: "manual-create-0001" };
    const response = await route.POST(postRequest(body));
    expect(response.status).toBe(201);
    await expect(response.clone().json()).resolves.toMatchObject({
      job: { updatedAt: "2026-08-17T00:00:00.000Z" },
    });
    expect(createManual).toHaveBeenCalledWith(
      { userId: "admin-1", email: "owner@example.test" },
      body,
      { canUpdateFinance: true },
    );
  });

  it("rejects a cross-origin create before the service runs", async () => {
    const createManual = vi.fn();
    const route = createAdminJobsRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "staff-1", email: "staff@example.test" },
        adminRole: "staff",
        adminPermissions: [],
      }),
      list: vi.fn(),
      createManual,
      trustedOrigin: origin,
    });
    const response = await route.POST(postRequest(
      { idempotencyKey: "manual-create-0002" },
      "https://attacker.example",
    ));
    expect(response.status).toBe(403);
    expect(createManual).not.toHaveBeenCalled();
  });
});
