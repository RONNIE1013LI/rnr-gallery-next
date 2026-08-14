import { describe, expect, it, vi } from "vitest";
import { createProductionJobFileRoute } from "./route-handler";
import { ProductionProofForbiddenError } from "@/server/production/production-proof-service";

const jobId = "de31f47e-0fb9-438e-bef6-6bc45556d3bb";
const fileId = "e23a9f59-bf54-4bb6-a7d0-9239c14cf819";

describe("production private file route", () => {
  it("streams an authorized job-owned file without caching", async () => {
    const route = createProductionJobFileRoute({
      requirePermission: vi.fn().mockResolvedValue({ user: { id: "staff-1" }, adminRole: "staff" }),
      getPrivateFile: vi.fn().mockResolvedValue({ storageKey: `${fileId}.bin`, mediaType: "image/jpeg", originalName: "draft.jpg", kind: "design_draft" }),
      read: vi.fn().mockResolvedValue(Buffer.from("abc")),
    });
    const response = await route.GET(new Request(`https://shop.example.test/api/admin/jobs/${jobId}/files/${fileId}`), {
      params: Promise.resolve({ jobId, fileId }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("abc");
  });

  it("does not expose payment proof bytes to staff", async () => {
    const getPrivateFile = vi.fn().mockRejectedValue(new ProductionProofForbiddenError());
    const route = createProductionJobFileRoute({
      requirePermission: vi.fn().mockResolvedValue({ user: { id: "staff-1" }, adminRole: "staff" }), getPrivateFile, read: vi.fn(),
    });
    const response = await route.GET(new Request(`https://shop.example.test/api/admin/jobs/${jobId}/files/${fileId}`), {
      params: Promise.resolve({ jobId, fileId }),
    });
    expect(response.status).toBe(403);
  });
});
