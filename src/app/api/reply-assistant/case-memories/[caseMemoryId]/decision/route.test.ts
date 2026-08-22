import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { createCaseMemoryDecisionHandler } from "./route-handler";

const request = (body: unknown) => new Request("https://admin.test/api/reply-assistant/case-memories/11111111-1111-4111-8111-111111111111/decision", {
  method: "POST", headers: { origin: "https://admin.test", "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("case memory decision API", () => {
  it("requires admin review permission and binds only the route case id", async () => {
    const requirePermission = vi.fn(async () => ({ user: { id: "admin-1" } }));
    const decide = vi.fn(async () => ({ status: "approved_reusable" as const }));
    const handler = createCaseMemoryDecisionHandler({
      enabled: true, trustedOrigin: "https://admin.test", requirePermission, decide,
    });
    const response = await handler.POST(request({ action: "approve", reason: null }), {
      params: Promise.resolve({ caseMemoryId: "11111111-1111-4111-8111-111111111111" }),
    });
    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("review_reply_learning");
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({
      caseMemoryId: "11111111-1111-4111-8111-111111111111", reviewerUserId: "admin-1",
    }));
  });

  it("returns 403 when staff lacks review permission", async () => {
    const handler = createCaseMemoryDecisionHandler({
      enabled: true, trustedOrigin: "https://admin.test",
      requirePermission: vi.fn(async () => { throw new HttpError("Forbidden", 403); }),
      decide: vi.fn(),
    });
    expect((await handler.POST(request({ action: "reject", reason: "Not reusable" }), {
      params: Promise.resolve({ caseMemoryId: "11111111-1111-4111-8111-111111111111" }),
    })).status).toBe(403);
  });
});
