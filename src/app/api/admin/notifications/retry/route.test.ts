import { describe, expect, it, vi } from "vitest";
import { createNotificationRetryRoute } from "./route-handler";

describe("admin notification retry route", () => {
  it("requires production-file permission and a trusted mutation", async () => {
    const requirePermission = vi.fn().mockResolvedValue({ user: { id: "staff-1" }, adminRole: "staff" });
    const deliverForFile = vi.fn().mockResolvedValue({ result: "sent" });
    const route = createNotificationRetryRoute({
      requirePermission,
      deliverForFile,
      trustedOrigin: "https://shop.example",
    });

    const response = await route.POST(new Request("https://shop.example/api/admin/notifications/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://shop.example" },
      body: JSON.stringify({ fileId: "10000000-0000-4000-8000-000000000001" }),
    }));

    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("upload_production_files");
    expect(deliverForFile).toHaveBeenCalledWith("10000000-0000-4000-8000-000000000001");
  });
});
