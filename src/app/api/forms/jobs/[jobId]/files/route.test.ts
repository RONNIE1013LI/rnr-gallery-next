import { describe, expect, it, vi } from "vitest";
import { createFormsJobFilesRoute } from "./route-handler";

const jobId = "de31f47e-0fb9-438e-bef6-6bc45556d3bb";
const access = {
  user: { id: "staff-1", email: "staff@example.test" },
  formRole: "form_staff" as const,
  formProfile: { preset: "manager" as const, assignedOnly: false, permissions: { upload_files: true, update_finance: false } as never },
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
    const route = createFormsJobFilesRoute({
      requirePermission: vi.fn().mockResolvedValue(access),
      assertScope,
      save: vi.fn().mockResolvedValue(reference),
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
    expect(registerFile).toHaveBeenCalledWith(
      { userId: "staff-1", email: "staff@example.test" }, jobId,
      { kind: "design_draft", idempotencyKey: "upload-request-1", reference },
      { canManageFinance: false },
    );
  });
});
