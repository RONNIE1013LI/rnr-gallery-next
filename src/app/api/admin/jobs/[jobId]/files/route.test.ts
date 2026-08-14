import { describe, expect, it, vi } from "vitest";
import { createProductionJobFilesRoute } from "./route-handler";

const jobId = "de31f47e-0fb9-438e-bef6-6bc45556d3bb";
const access = { user: { id: "user-1", email: "staff@example.com" }, adminRole: "staff" as const };
const reference = {
  id: "e23a9f59-bf54-4bb6-a7d0-9239c14cf819",
  originalName: "draft.jpg", mimeType: "image/jpeg", size: 3,
  storageKey: "e23a9f59-bf54-4bb6-a7d0-9239c14cf819.bin", sha256: "a".repeat(64),
};

function request(kind = "design_draft") {
  const body = new FormData();
  body.set("kind", kind);
  body.set("idempotencyKey", "upload-request-1");
  body.set("file", new File(["abc"], "draft.jpg", { type: "image/jpeg" }));
  return new Request(`https://shop.example.test/api/admin/jobs/${jobId}/files`, {
    method: "POST", body, headers: { Origin: "https://shop.example.test", "Sec-Fetch-Site": "same-origin" },
  });
}

function parseForm(kind = "design_draft") {
  return vi.fn().mockResolvedValue({
    kind,
    idempotencyKey: "upload-request-1",
    file: new File(["abc"], "draft.jpg", { type: "image/jpeg" }),
  });
}

describe("production job files route", () => {
  it("stores a private upload and registers its metadata", async () => {
    const save = vi.fn().mockResolvedValue(reference);
    const registerFile = vi.fn().mockResolvedValue({ result: "created", file: { id: reference.id } });
    const route = createProductionJobFilesRoute({
      requirePermission: vi.fn().mockResolvedValue(access), save, remove: vi.fn(),
      registerFile, trustedOrigin: "https://shop.example.test", parseForm: parseForm(),
    });
    const response = await route.POST(request(), { params: Promise.resolve({ jobId }) });
    expect(response.status).toBe(201);
    expect(registerFile).toHaveBeenCalledWith(
      { userId: "user-1", email: "staff@example.com" }, jobId,
      { kind: "design_draft", idempotencyKey: "upload-request-1", reference },
      { canManageFinance: false },
    );
  });

  it("removes newly written bytes on a duplicate retry", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const route = createProductionJobFilesRoute({
      requirePermission: vi.fn().mockResolvedValue(access),
      save: vi.fn().mockResolvedValue(reference), remove,
      registerFile: vi.fn().mockResolvedValue({ result: "duplicate", file: { id: "prior" } }),
      trustedOrigin: "https://shop.example.test", parseForm: parseForm(),
    });
    const response = await route.POST(request(), { params: Promise.resolve({ jobId }) });
    expect(response.status).toBe(200);
    expect(remove).toHaveBeenCalledWith(reference);
  });

  it("rejects payment proofs from staff before saving bytes", async () => {
    const save = vi.fn();
    const route = createProductionJobFilesRoute({
      requirePermission: vi.fn().mockResolvedValue(access), save, remove: vi.fn(),
      registerFile: vi.fn(), trustedOrigin: "https://shop.example.test", parseForm: parseForm("payment_proof"),
    });
    const response = await route.POST(request("payment_proof"), { params: Promise.resolve({ jobId }) });
    expect(response.status).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });
});
