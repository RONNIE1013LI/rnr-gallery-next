import { describe, expect, it, vi } from "vitest";
import { buildFormAccessProfile } from "@/server/forms/forms-permissions";
import { createFormsJobFilesRoute } from "./route-handler";

const jobId = "de31f47e-0fb9-438e-bef6-6bc45556d3bb";
const access = {
  user: { id: "staff-1", email: "staff@example.test" },
  formRole: "form_staff" as const,
  formProfile: buildFormAccessProfile("manager"),
};
const financeAccess = {
  user: { id: "admin-1", email: "admin@example.test" },
  formRole: "admin" as const,
  formProfile: null,
};
const reference = {
  id: "e23a9f59-bf54-4bb6-a7d0-9239c14cf819",
  originalName: "draft.jpg", mimeType: "image/jpeg", size: 3,
  storageKey: "e23a9f59-bf54-4bb6-a7d0-9239c14cf819.bin", sha256: "a".repeat(64),
};

describe("forms job file upload route", () => {
  it("checks forms permission and assignment before registering a private upload", async () => {
    const registerFile = vi.fn().mockResolvedValue({ result: "created", file: { id: reference.id } });
    const assertScope = vi.fn().mockResolvedValue(undefined);
    const save = vi.fn().mockResolvedValue(reference);
    const route = createFormsJobFilesRoute({
      requirePermission: vi.fn().mockResolvedValue(access),
      assertScope,
      save,
      remove: vi.fn(),
      registerFile,
      trustedOrigin: "https://shop.example.test",
      parseForm: vi.fn().mockResolvedValue({
        kind: "design_draft", idempotencyKey: "upload-request-1",
        file: new File(["abc"], "draft.jpg", { type: "image/jpeg" }),
      }),
    });
    const response = await route.POST(new Request(`https://shop.example.test/api/forms/jobs/${jobId}/files`, {
      method: "POST", headers: { Origin: "https://shop.example.test" }, body: new FormData(),
    }), { params: Promise.resolve({ jobId }) });
    expect(response.status).toBe(201);
    expect(assertScope).toHaveBeenCalledWith(access, jobId);
    expect(save).toHaveBeenCalledWith(expect.any(File), { allowPdf: false });
    expect(registerFile).toHaveBeenCalledWith(
      { userId: "staff-1", email: "staff@example.test" }, jobId,
      { kind: "design_draft", idempotencyKey: "upload-request-1", reference },
      { canManageFinance: false },
    );
  });

  it("allows PDF validation only for a finance-authorised payment proof", async () => {
    const save = vi.fn().mockResolvedValue({
      ...reference,
      originalName: "receipt.pdf",
      mimeType: "application/pdf",
    });
    const route = createFormsJobFilesRoute({
      requirePermission: vi.fn().mockResolvedValue(financeAccess),
      assertScope: vi.fn().mockResolvedValue(undefined),
      save,
      remove: vi.fn(),
      registerFile: vi.fn().mockResolvedValue({ result: "created", file: { id: reference.id } }),
      trustedOrigin: "https://shop.example.test",
      parseForm: vi.fn().mockResolvedValue({
        kind: "payment_proof",
        idempotencyKey: "payment-proof-request-1",
        file: new File(["%PDF-1.7"], "receipt.pdf", { type: "application/pdf" }),
      }),
    });

    const response = await route.POST(new Request(`https://shop.example.test/api/forms/jobs/${jobId}/files`, {
      method: "POST",
      headers: { Origin: "https://shop.example.test" },
      body: new FormData(),
    }), { params: Promise.resolve({ jobId }) });

    expect(response.status).toBe(201);
    expect(save).toHaveBeenCalledWith(expect.any(File), { allowPdf: true });
  });
});
