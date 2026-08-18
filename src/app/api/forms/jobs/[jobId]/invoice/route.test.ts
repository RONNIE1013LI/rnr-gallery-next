import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { createFormsJobInvoiceRoute } from "./route-handler";

const origin = "https://shop.example.test";
const jobId = "00000000-0000-4000-8000-000000000001";
const invoiceId = "00000000-0000-4000-8000-000000000010";
const context = { params: Promise.resolve({ jobId }) };
const access = {
  user: { id: "finance-1", email: "finance@example.test" }, formRole: "form_staff" as const,
  formProfile: { preset: "finance" as const, assignedOnly: false, permissions: { view_finance: true, update_finance: true } as never },
};

function mutation(body: unknown) {
  return new Request(`${origin}/api/forms/jobs/${jobId}/invoice`, {
    method: "PUT", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body),
  });
}

describe("forms job invoice route", () => {
  it("denies an assigned artist without finance before loading an invoice", async () => {
    const getOrCreateDraft = vi.fn();
    const route = createFormsJobInvoiceRoute({
      requirePermission: vi.fn().mockRejectedValue(new HttpError("Forbidden", 403)),
      assertScope: vi.fn(), getOrCreateDraft, updateDraft: vi.fn(), issue: vi.fn(), void: vi.fn(),
    });

    const response = await route.GET(new Request(`${origin}/api/forms/jobs/${jobId}/invoice`), context);

    expect(response.status).toBe(403);
    expect(getOrCreateDraft).not.toHaveBeenCalled();
  });

  it("checks finance-view and job scope before loading or seeding an invoice", async () => {
    const assertScope = vi.fn().mockResolvedValue(undefined);
    const getOrCreateDraft = vi.fn().mockResolvedValue({ id: invoiceId, status: "draft" });
    const requirePermission = vi.fn().mockResolvedValue(access);
    const route = createFormsJobInvoiceRoute({
      requirePermission, assertScope, getOrCreateDraft, updateDraft: vi.fn(), issue: vi.fn(), void: vi.fn(),
    });
    const response = await route.GET(new Request(`${origin}/api/forms/jobs/${jobId}/invoice`), context);
    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("view_finance");
    expect(assertScope).toHaveBeenCalledWith(access, jobId);
    expect(getOrCreateDraft).toHaveBeenCalledWith({ userId: "finance-1", email: "finance@example.test" }, jobId);
  });

  it("checks update-finance and job scope before changing a draft", async () => {
    const assertScope = vi.fn().mockResolvedValue(undefined);
    const updateDraft = vi.fn().mockResolvedValue({ id: invoiceId, status: "draft" });
    const route = createFormsJobInvoiceRoute({
      requirePermission: vi.fn().mockResolvedValue(access), assertScope,
      getOrCreateDraft: vi.fn(), updateDraft, issue: vi.fn(), void: vi.fn(), trustedOrigin: origin,
    });
    const body = { invoiceId, idempotencyKey: "invoice-update-0001", expectedUpdatedAt: "2026-08-05T00:00:00.000Z", draft: {} };
    const response = await route.PUT(mutation(body), context);
    expect(response.status).toBe(200);
    expect(assertScope).toHaveBeenCalledWith(access, jobId);
    expect(updateDraft).toHaveBeenCalledWith({ userId: "finance-1", email: "finance@example.test" }, body);
  });
});
