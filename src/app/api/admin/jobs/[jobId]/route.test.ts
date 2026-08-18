import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { ProductionJobConflictError } from "@/server/production/production-job-service";
import { createAdminJobRoute } from "./route-handler";

const origin = "http://localhost:3000";
const jobId = "00000000-0000-4000-8000-000000000001";

function request(body: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/admin/jobs/${jobId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Origin: requestOrigin,
      "Sec-Fetch-Site": requestOrigin === origin ? "same-origin" : "cross-site",
    },
    body: JSON.stringify(body),
  });
}

describe("admin production job update route", () => {
  it("requires production update permission before reading the body", async () => {
    const update = vi.fn();
    const route = createAdminJobRoute({
      requirePermission: vi.fn().mockRejectedValue(new HttpError("Forbidden", 403)),
      update,
      trustedOrigin: origin,
    });
    const response = await route.PATCH(request({ urgent: true }), {
      params: Promise.resolve({ jobId }),
    });
    expect(response.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it("passes the authenticated role's finance capability to the service", async () => {
    const update = vi.fn().mockResolvedValue("updated");
    const route = createAdminJobRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "staff-1", email: "staff@example.test" },
        adminRole: "staff",
        adminPermissions: ["update_production_jobs"],
      }),
      update,
      trustedOrigin: origin,
    });
    const body = {
      idempotencyKey: "job-update-0001",
      expectedUpdatedAt: "2026-08-04T10:00:00.000Z",
      urgent: true,
    };
    const response = await route.PATCH(request(body), {
      params: Promise.resolve({ jobId }),
    });
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      { userId: "staff-1", email: "staff@example.test" },
      { ...body, jobId },
      { canUpdateFinance: false },
    );
  });

  it("returns 409 for optimistic concurrency conflicts", async () => {
    const route = createAdminJobRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "admin-1", email: "owner@example.test" },
        adminRole: "admin",
        adminPermissions: [],
      }),
      update: vi.fn().mockRejectedValue(new ProductionJobConflictError()),
      trustedOrigin: origin,
    });
    const response = await route.PATCH(request({
      idempotencyKey: "job-update-0002",
      expectedUpdatedAt: "2026-08-04T10:00:00.000Z",
      urgent: true,
    }), { params: Promise.resolve({ jobId }) });
    expect(response.status).toBe(409);
  });
});
