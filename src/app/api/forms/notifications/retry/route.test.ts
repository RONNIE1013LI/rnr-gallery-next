import { describe, expect, it, vi } from "vitest";
import { createFormsNotificationRetryRoute } from "./route-handler";

describe("forms notification retry route", () => {
  it("requires upload permission, trusted origin and matching job scope", async () => {
    const jobId = "00000000-0000-4000-8000-000000000001";
    const fileId = "10000000-0000-4000-8000-000000000001";
    const access = {
      user: { id: "staff-1" }, formRole: "form_staff" as const,
      formProfile: { preset: "manager" as const, assignedOnly: false, permissions: { upload_files: true } as never },
    };
    const assertScope = vi.fn().mockResolvedValue(undefined);
    const deliverForFile = vi.fn().mockResolvedValue({ result: "sent" });
    const route = createFormsNotificationRetryRoute({
      requirePermission: vi.fn().mockResolvedValue(access), assertScope, deliverForFile,
      trustedOrigin: "https://shop.example.test",
    });
    const response = await route.POST(new Request("https://shop.example.test/api/forms/notifications/retry", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "https://shop.example.test" },
      body: JSON.stringify({ jobId, fileId }),
    }));
    expect(response.status).toBe(200);
    expect(assertScope).toHaveBeenCalledWith(access, jobId);
    expect(deliverForFile).toHaveBeenCalledWith(fileId);
  });
});
