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

function evidenceRequest(body: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/admin/jobs/${jobId}`, {
    method: "POST",
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

  it("records conversion evidence only for an authenticated finance administrator", async () => {
    const recordConversionEvidence = vi.fn().mockResolvedValue("recorded");
    const requirePermission = vi.fn().mockResolvedValue({
      user: { id: "admin-1", email: "owner@example.test" },
      adminRole: "admin",
      adminPermissions: [],
    });
    const route = createAdminJobRoute({
      requirePermission,
      update: vi.fn(),
      recordConversionEvidence,
      trustedOrigin: origin,
    });
    const response = await route.POST(evidenceRequest({
      consentDecision: "granted",
      consentRecordedAt: "2026-08-28T04:30:00.000Z",
      source: "meta",
      attribution: { fbp: "fb.1.1720000000000.123456789" },
    }), { params: Promise.resolve({ jobId }) });

    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("update_production_finance");
    expect(recordConversionEvidence).toHaveBeenCalledWith({
      jobId,
      actor: { userId: "admin-1", email: "owner@example.test" },
      consentDecision: "granted",
      consentRecordedAt: new Date("2026-08-28T04:30:00.000Z"),
      source: "meta",
      attribution: { fbp: "fb.1.1720000000000.123456789" },
    });
  });

  it("rejects untrusted or late conversion evidence without persisting it", async () => {
    const recordConversionEvidence = vi.fn().mockResolvedValue("already_paid");
    const route = createAdminJobRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "admin-1", email: "owner@example.test" },
        adminRole: "admin",
        adminPermissions: [],
      }),
      update: vi.fn(),
      recordConversionEvidence,
      trustedOrigin: origin,
    });
    const body = {
      consentDecision: "granted",
      consentRecordedAt: "2026-08-28T04:30:00.000Z",
      source: "google",
      attribution: { gclid: "synthetic-gclid" },
    };

    expect((await route.POST(evidenceRequest(body, "https://evil.example.test"), {
      params: Promise.resolve({ jobId }),
    })).status).toBe(403);
    expect(recordConversionEvidence).not.toHaveBeenCalled();

    expect((await route.POST(evidenceRequest(body), {
      params: Promise.resolve({ jobId }),
    })).status).toBe(409);
  });
});
