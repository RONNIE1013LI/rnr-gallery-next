import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { createFormsJobFileRoute } from "./route-handler";

const jobId = "de31f47e-0fb9-438e-bef6-6bc45556d3bb";
const fileId = "e23a9f59-bf54-4bb6-a7d0-9239c14cf819";

describe("forms private file route", () => {
  it("denies a profile without view_files before reading private storage", async () => {
    const read = vi.fn();
    const route = createFormsJobFileRoute({
      requirePermission: vi.fn().mockRejectedValue(new HttpError("Forbidden", 403)),
      assertScope: vi.fn(), getPrivateFile: vi.fn(), read,
    });

    const response = await route.GET(new Request(`https://shop.example.test/api/forms/jobs/${jobId}/files/${fileId}`), {
      params: Promise.resolve({ jobId, fileId }),
    });

    expect(response.status).toBe(403);
    expect(read).not.toHaveBeenCalled();
  });

  it("checks forms scope and streams a job-owned file without caching", async () => {
    const access = {
      user: { id: "artist-1" }, formRole: "form_staff" as const,
      formProfile: { preset: "artist" as const, assignedOnly: true, permissions: { view_files: true, view_finance: false } as never },
    };
    const assertScope = vi.fn().mockResolvedValue(undefined);
    const getPrivateFile = vi.fn().mockResolvedValue({ storageKey: `${fileId}.bin`, mediaType: "image/jpeg", originalName: "draft.jpg" });
    const route = createFormsJobFileRoute({
      requirePermission: vi.fn().mockResolvedValue(access), assertScope, getPrivateFile,
      read: vi.fn().mockResolvedValue(Buffer.from("abc")),
    });
    const response = await route.GET(new Request(`https://shop.example.test/api/forms/jobs/${jobId}/files/${fileId}`), {
      params: Promise.resolve({ jobId, fileId }),
    });
    expect(response.status).toBe(200);
    expect(assertScope).toHaveBeenCalledWith(access, jobId);
    expect(getPrivateFile).toHaveBeenCalledWith(jobId, fileId, { canViewFinance: false });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
