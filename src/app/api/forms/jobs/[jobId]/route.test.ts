import { describe, expect, it, vi } from "vitest";

import { HttpError } from "@/server/auth/require-session";
import { ProductionJobConflictError } from "@/server/production/production-job-service";
import { createFormsJobRoute } from "./route-handler";

const adminAccess = {
  user: { id: "admin-1", email: "admin@example.test" },
  formRole: "admin" as const,
  formProfile: null,
};
const context = { params: Promise.resolve({ jobId: "550e8400-e29b-41d4-a716-446655440000" }) };

function request(body: object, origin = "https://shop.example.test") {
  return new Request("https://shop.example.test/api/forms/jobs/550e8400-e29b-41d4-a716-446655440000", {
    method: "PATCH",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

describe("forms job inline update route", () => {
  it("maps an inline milestone to the existing audited production update", async () => {
    const update = vi.fn().mockResolvedValue("updated");
    const route = createFormsJobRoute({
      requirePermission: vi.fn().mockResolvedValue(adminAccess),
      update,
      detail: vi.fn().mockResolvedValue({ job: { updatedAt: new Date("2026-08-05T02:00:00.000Z") } }),
      trustedOrigin: "https://shop.example.test",
    });
    const response = await route.PATCH(request({
      field: "printed", value: true,
      expectedUpdatedAt: "2026-08-05T01:00:00.000Z",
      idempotencyKey: "inline-printed-123",
    }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ version: "2026-08-05T02:00:00.000Z" });
    expect(update).toHaveBeenCalledWith(
      { userId: "admin-1", email: "admin@example.test" },
      expect.objectContaining({
        jobId: "550e8400-e29b-41d4-a716-446655440000",
        milestones: { printed: true },
      }),
      { canUpdateFinance: true },
    );
  });

  it("accepts the mature full-detail editor payload through the same production service", async () => {
    const update = vi.fn().mockResolvedValue("updated");
    const route = createFormsJobRoute({
      requirePermission: vi.fn().mockResolvedValue(adminAccess),
      update,
      detail: vi.fn().mockResolvedValue({ job: { updatedAt: new Date("2026-08-05T02:00:00.000Z") } }),
      trustedOrigin: "https://shop.example.test",
    });
    const body = {
      urgent: true,
      neededDate: "2026-08-12",
      deliveryMethod: "post",
      expectedUpdatedAt: "2026-08-05T01:00:00.000Z",
      idempotencyKey: "detail-update-123",
    };
    const response = await route.PATCH(request(body), context);
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      { userId: "admin-1", email: "admin@example.test" },
      { ...body, jobId: "550e8400-e29b-41d4-a716-446655440000" },
      { canUpdateFinance: true },
    );
  });

  it("rejects unauthorised, cross-origin and linked web finance changes before update", async () => {
    const update = vi.fn();
    const forbidden = createFormsJobRoute({
      requirePermission: vi.fn().mockRejectedValue(new HttpError("Forbidden", 403)),
      update,
      detail: vi.fn(),
      trustedOrigin: "https://shop.example.test",
    });
    expect((await forbidden.PATCH(request({}), context)).status).toBe(403);

    const route = createFormsJobRoute({
      requirePermission: vi.fn().mockResolvedValue(adminAccess),
      update,
      detail: vi.fn().mockResolvedValue({ job: { source: "web" } }),
      trustedOrigin: "https://shop.example.test",
    });
    expect((await route.PATCH(request({
      field: "urgent", value: true,
      expectedUpdatedAt: "2026-08-05T01:00:00.000Z", idempotencyKey: "inline-urgent-123",
    }, "https://evil.example.test"), context)).status).toBe(403);
    expect((await route.PATCH(request({
      field: "amountPayable", value: 23000,
      expectedUpdatedAt: "2026-08-05T01:00:00.000Z", idempotencyKey: "inline-total-123",
    }), context)).status).toBe(422);
    expect(update).not.toHaveBeenCalled();
  });

  it("returns 409 when another operator saved the job first", async () => {
    const route = createFormsJobRoute({
      requirePermission: vi.fn().mockResolvedValue(adminAccess),
      update: vi.fn().mockRejectedValue(new ProductionJobConflictError("The job changed before this update was saved")),
      detail: vi.fn(),
      trustedOrigin: "https://shop.example.test",
    });
    const response = await route.PATCH(request({
      field: "remark", value: "Updated",
      expectedUpdatedAt: "2026-08-05T01:00:00.000Z", idempotencyKey: "inline-remark-123",
    }), context);
    expect(response.status).toBe(409);
  });

  it("prevents assigned-only staff from updating another artist's job", async () => {
    const update = vi.fn();
    const route = createFormsJobRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "artist-1", email: "artist@example.test" },
        formRole: "form_staff",
        formProfile: {
          preset: "artist", assignedOnly: true,
          permissions: { view_jobs: true, update_jobs: true },
        },
      }),
      update,
      detail: vi.fn().mockResolvedValue({ job: { assignedUserId: "artist-2" } }),
      trustedOrigin: "https://shop.example.test",
    });
    const response = await route.PATCH(request({
      field: "remark", value: "Should not save",
      expectedUpdatedAt: "2026-08-05T01:00:00.000Z", idempotencyKey: "assigned-only-123",
    }), context);
    expect(response.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("forms job detail route", () => {
  it("includes permission-filtered files, notifications and assignees for the drawer", async () => {
    const route = createFormsJobRoute({
      requirePermission: vi.fn().mockResolvedValue(adminAccess),
      update: vi.fn(),
      detail: vi.fn().mockResolvedValue({ job: { assignedUserId: null, customerEmail: "a@example.test", customerPhone: "1" }, finance: null, audit: [] }),
      listFiles: vi.fn().mockResolvedValue({ files: [{ id: "file-1" }], revision: { changesRequested: 0, freeRevisionsRemaining: 2, requiresAdditionalChargeReview: false } }),
      listNotifications: vi.fn().mockResolvedValue([{ fileId: "file-1", status: "sent" }]),
      assignees: vi.fn().mockResolvedValue([{ id: "artist-1", name: "Artist" }]),
    });
    const response = await route.GET(new Request("https://shop.example.test"), context);
    expect(await response.json()).toMatchObject({
      files: [{ id: "file-1" }],
      notifications: [{ fileId: "file-1" }],
      assignees: [{ id: "artist-1" }],
      revision: { freeRevisionsRemaining: 2 },
    });
  });

  it("enforces assigned-only scope and redacts protected detail fields", async () => {
    const route = createFormsJobRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "artist-1", email: "artist@example.test" },
        formRole: "form_staff",
        formProfile: {
          preset: "artist", assignedOnly: true,
          permissions: { view_jobs: true, view_customer_contact: false, view_finance: false, view_audit: false },
        },
      }),
      update: vi.fn(),
      detail: vi.fn().mockResolvedValue({
        job: { id: "550e8400-e29b-41d4-a716-446655440000", assignedUserId: "artist-1", customerEmail: "private@example.test", customerPhone: "0210000000" },
        finance: null,
        audit: [{ id: "audit-1", actorEmail: "admin@example.test" }],
      }),
      trustedOrigin: "https://shop.example.test",
    });
    const response = await route.GET(
      new Request("https://shop.example.test/api/forms/jobs/550e8400-e29b-41d4-a716-446655440000"),
      context,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.detail.job).toMatchObject({ customerEmail: "", customerPhone: "" });
    expect(body.detail.audit).toEqual([]);
  });

  it("returns 404 when an assigned-only artist opens another artist's job", async () => {
    const route = createFormsJobRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "artist-1", email: "artist@example.test" },
        formRole: "form_staff",
        formProfile: { preset: "artist", assignedOnly: true, permissions: { view_jobs: true } },
      }),
      update: vi.fn(),
      detail: vi.fn().mockResolvedValue({ job: { assignedUserId: "artist-2" } }),
    });
    expect((await route.GET(new Request("https://shop.example.test"), context)).status).toBe(404);
  });
});
