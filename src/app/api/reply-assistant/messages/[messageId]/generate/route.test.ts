import { describe, expect, it, vi } from "vitest";
import { createGenerateHandler } from "./route-handler";

describe("reply assistant generate API", () => {
  it("requires permission, trusted origin and internal UUID", async () => {
    const requirePermission = vi.fn(async () => ({ user: { id: "staff-1" }, adminRole: "staff" as const }));
    const generate = vi.fn(async () => ({ status: "draft_ready" as const, attemptId: "attempt-1" }));
    const handler = createGenerateHandler({ enabled: true, requirePermission, generate, trustedOrigin: "https://admin.test" });
    const response = await handler.POST(new Request("https://admin.test/api/reply-assistant/messages/11111111-1111-4111-8111-111111111111/generate", {
      method: "POST",
      headers: { origin: "https://admin.test", "content-type": "application/json" },
      body: "{}",
    }), { params: Promise.resolve({ messageId: "11111111-1111-4111-8111-111111111111" }) });
    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("use_reply_assistant");
    expect(generate).toHaveBeenCalledWith({ messageId: "11111111-1111-4111-8111-111111111111", trigger: "manual_generate" });
  });
});
