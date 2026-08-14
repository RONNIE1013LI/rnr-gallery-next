import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { InvoiceConflictError } from "@/server/invoices/invoice-service";
import { createAdminJobInvoiceRoute } from "./route-handler";

const origin = "http://localhost:3000";
const jobId = "00000000-0000-4000-8000-000000000001";
const invoiceId = "00000000-0000-4000-8000-000000000010";
const access = {
  user: { id: "admin-1", email: "owner@example.test" },
  adminRole: "admin" as const,
};
const context = { params: Promise.resolve({ jobId }) };

function mutation(method: "PUT" | "POST", body: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/admin/jobs/${jobId}/invoice`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: requestOrigin,
      "Sec-Fetch-Site": requestOrigin === origin ? "same-origin" : "cross-site",
    },
    body: JSON.stringify(body),
  });
}

describe("admin job invoice route", () => {
  it("requires finance-view permission before seeding a draft", async () => {
    const getOrCreateDraft = vi.fn();
    const route = createAdminJobInvoiceRoute({
      requirePermission: vi.fn().mockRejectedValue(new HttpError("Forbidden", 403)),
      getOrCreateDraft,
      updateDraft: vi.fn(),
      issue: vi.fn(),
      void: vi.fn(),
      trustedOrigin: origin,
    });
    const response = await route.GET(new Request(`${origin}/api/admin/jobs/${jobId}/invoice`), context);
    expect(response.status).toBe(403);
    expect(getOrCreateDraft).not.toHaveBeenCalled();
  });

  it("gets or seeds the persisted invoice", async () => {
    const getOrCreateDraft = vi.fn().mockResolvedValue({ id: invoiceId, status: "draft" });
    const requirePermission = vi.fn().mockResolvedValue(access);
    const route = createAdminJobInvoiceRoute({
      requirePermission,
      getOrCreateDraft,
      updateDraft: vi.fn(),
      issue: vi.fn(),
      void: vi.fn(),
      trustedOrigin: origin,
    });
    const response = await route.GET(new Request(`${origin}/api/admin/jobs/${jobId}/invoice`), context);
    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("view_production_finance");
    expect(getOrCreateDraft).toHaveBeenCalledWith(
      { userId: "admin-1", email: "owner@example.test" },
      jobId,
    );
  });

  it("rejects cross-origin draft updates before mutation", async () => {
    const updateDraft = vi.fn();
    const route = createAdminJobInvoiceRoute({
      requirePermission: vi.fn().mockResolvedValue(access),
      getOrCreateDraft: vi.fn(),
      updateDraft,
      issue: vi.fn(),
      void: vi.fn(),
      trustedOrigin: origin,
    });
    const response = await route.PUT(mutation("PUT", { invoiceId }, "https://evil.example"), context);
    expect(response.status).toBe(403);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it("updates a draft with the authenticated actor", async () => {
    const updateDraft = vi.fn().mockResolvedValue({ id: invoiceId, status: "draft" });
    const route = createAdminJobInvoiceRoute({
      requirePermission: vi.fn().mockResolvedValue(access),
      getOrCreateDraft: vi.fn(),
      updateDraft,
      issue: vi.fn(),
      void: vi.fn(),
      trustedOrigin: origin,
    });
    const body = { invoiceId, idempotencyKey: "invoice-update-0001", expectedUpdatedAt: "2026-08-05T00:00:00.000Z", draft: {} };
    const response = await route.PUT(mutation("PUT", body), context);
    expect(response.status).toBe(200);
    expect(updateDraft).toHaveBeenCalledWith(
      { userId: "admin-1", email: "owner@example.test" },
      body,
    );
  });

  it("issues or voids through explicit lifecycle actions", async () => {
    const issue = vi.fn().mockResolvedValue({ id: invoiceId, status: "issued" });
    const voidInvoice = vi.fn().mockResolvedValue({ id: invoiceId, status: "void" });
    const route = createAdminJobInvoiceRoute({
      requirePermission: vi.fn().mockResolvedValue(access),
      getOrCreateDraft: vi.fn(),
      updateDraft: vi.fn(),
      issue,
      void: voidInvoice,
      trustedOrigin: origin,
    });
    const common = { invoiceId, idempotencyKey: "invoice-action-0001", expectedUpdatedAt: "2026-08-05T00:00:00.000Z" };
    expect((await route.POST(mutation("POST", { action: "issue", ...common }), context)).status).toBe(200);
    expect(issue).toHaveBeenCalledWith(expect.any(Object), common);
    expect((await route.POST(mutation("POST", { action: "void", reason: "Duplicate", ...common }), context)).status).toBe(200);
    expect(voidInvoice).toHaveBeenCalledWith(expect.any(Object), { ...common, reason: "Duplicate" });
  });

  it("returns 409 for optimistic concurrency conflicts", async () => {
    const route = createAdminJobInvoiceRoute({
      requirePermission: vi.fn().mockResolvedValue(access),
      getOrCreateDraft: vi.fn(),
      updateDraft: vi.fn().mockRejectedValue(new InvoiceConflictError()),
      issue: vi.fn(),
      void: vi.fn(),
      trustedOrigin: origin,
    });
    const response = await route.PUT(mutation("PUT", {
      invoiceId,
      idempotencyKey: "invoice-update-0002",
      expectedUpdatedAt: "2026-08-05T00:00:00.000Z",
      draft: {},
    }), context);
    expect(response.status).toBe(409);
  });
});
