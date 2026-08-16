import { describe, expect, it, vi } from "vitest";
import { createFeedbackHandler } from "./route-handler";

describe("reply assistant feedback API", () => {
  it("records reviewed text without customer identity", async () => {
    const append = vi.fn(async () => undefined);
    const handler = createFeedbackHandler({
      enabled: true,
      trustedOrigin: "https://admin.test",
      requirePermission: vi.fn(async () => ({ user: { id: "staff-1" }, adminRole: "staff" as const })),
      append,
    });
    const response = await handler.POST(new Request("https://admin.test/api/reply-assistant/drafts/11111111-1111-4111-8111-111111111111/feedback", {
      method: "POST",
      headers: { origin: "https://admin.test", "content-type": "application/json" },
      body: JSON.stringify({ action: "edited", humanFinalText: "Thanks, please send the original photo 😊", reasonCode: "tone", idempotencyKey: "edit-1" }),
    }), { params: Promise.resolve({ attemptId: "11111111-1111-4111-8111-111111111111" }) });
    expect(response.status).toBe(201);
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: "staff-1", action: "edited" }));
  });
});
