import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { createLearningCandidateDecisionHandler } from "./route-handler";

const request = (body: unknown) => new Request("https://admin.test/api/reply-assistant/learning-candidates/11111111-1111-4111-8111-111111111111/decision", {
  method: "POST", headers: { origin: "https://admin.test", "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("learning candidate decision API", () => {
  it("requires the admin-only review permission", async () => {
    const requirePermission = vi.fn(async () => ({ user: { id: "admin-1" }, adminRole: "admin" as const }));
    const decide = vi.fn(async () => ({ status: "approved" as const }));
    const handler = createLearningCandidateDecisionHandler({ enabled: true, trustedOrigin: "https://admin.test", requirePermission, decide });
    const response = await handler.POST(request({ action: "edit_and_approve", approvedText: "Add one useful next step.", reason: null }), { params: Promise.resolve({ candidateId: "11111111-1111-4111-8111-111111111111" }) });
    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("review_reply_learning");
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ reviewerUserId: "admin-1", approvedText: "Add one useful next step." }));
  });

  it("returns 403 when staff lacks review permission", async () => {
    const handler = createLearningCandidateDecisionHandler({
      enabled: true, trustedOrigin: "https://admin.test",
      requirePermission: vi.fn(async () => { throw new HttpError("Forbidden", 403); }),
      decide: vi.fn(),
    });
    const response = await handler.POST(request({ action: "reject", approvedText: null, reason: "Not reusable" }), { params: Promise.resolve({ candidateId: "11111111-1111-4111-8111-111111111111" }) });
    expect(response.status).toBe(403);
  });
});
