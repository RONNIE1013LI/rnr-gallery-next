import { describe, expect, it, vi } from "vitest";
import { createMessagesHandler } from "./route-handler";

const forbiddenDtoPattern = new RegExp([
  ["source", "Url"].join(""),
  ["private", "Storage", "Key"].join(""),
  ["storage", "Key"].join(""),
  "sha256",
  ["external", "Attachment", "Key", "Hash"].join(""),
  ["sender", ".*", "hash"].join(""),
  ["conversation", ".*", "hash"].join(""),
  ["attachment", "Ids?"].join(""),
].join("|"), "i");

describe("reply assistant messages API", () => {
  it("requires permission and returns no-store safe DTOs", async () => {
    const requirePermission = vi.fn(async () => ({ user: { id: "staff-1" }, adminRole: "staff" as const }));
    const list = vi.fn(async () => ({ items: [{
      messageId: "11111111-1111-4111-8111-111111111111",
      body: "Hello",
      receivedAt: "2026-08-17T00:00:00.000Z",
      status: "received",
      latestAttemptId: null,
      draftText: null,
      gateResult: null,
      attachmentCount: 1,
      imageAnalysisStatus: "assessed" as const,
      imageAssessmentSummary: "Image 0 appears cropped; request an uncropped version.",
      humanReplyReceived: false,
      timeline: [{
        role: "staff" as const,
        text: "Please send the original photo.",
        receivedAt: "2026-08-17T00:00:01.000Z",
      }],
    }] }));
    const response = await createMessagesHandler({ enabled: true, requirePermission, list }).GET();
    expect(requirePermission).toHaveBeenCalledWith("use_reply_assistant");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({ items: [{
      messageId: "11111111-1111-4111-8111-111111111111",
      body: "Hello",
      receivedAt: "2026-08-17T00:00:00.000Z",
      status: "received",
      latestAttemptId: null,
      draftText: null,
      gateResult: null,
      attachmentCount: 1,
      imageAnalysisStatus: "assessed",
      imageAssessmentSummary: "Image 0 appears cropped; request an uncropped version.",
      humanReplyReceived: false,
      timeline: [{
        role: "staff",
        text: "Please send the original photo.",
        receivedAt: "2026-08-17T00:00:01.000Z",
      }],
    }] });
    expect(JSON.stringify(body)).not.toMatch(forbiddenDtoPattern);
  });
});
