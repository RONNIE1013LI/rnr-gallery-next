import { describe, expect, it, vi } from "vitest";
import { createLearningCandidatesHandler } from "./route-handler";

describe("learning candidates API", () => {
  it("allows staff to view safe pending candidates", async () => {
    const requirePermission = vi.fn(async () => ({ user: { id: "staff-1" }, adminRole: "staff" as const }));
    const list = vi.fn(async () => ({ items: [{ id: "candidate-1", intent: "design_process", proposedChange: "Add a next step.", reasonCodes: ["missing_next_step"], evidenceCount: 3, status: "pending" as const }] }));
    const response = await createLearningCandidatesHandler({ enabled: true, requirePermission, list }).GET();
    expect(requirePermission).toHaveBeenCalledWith("use_reply_assistant");
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toMatch(/conversation|sender|facebook|humanFinalText/i);
  });
});
