import { describe, expect, it } from "vitest";
import { validateDraft } from "./output-validator";

describe("AI draft output validator", () => {
  it("accepts a short low-risk next step", () => {
    expect(validateDraft(
      "Please send the original photo and we can assess it for you 😊",
      { intent: "photo_guidance" },
    )).toEqual({ ok: true, codes: [] });
  });

  it.each([
    ["We guarantee your blurry photo will print perfectly.", "forbidden_commitment"],
    ["The current price is $100.", "monetary_claim"],
    ["Two free revisions are included.", "unconfirmed_policy_claim"],
    ["As an AI assistant, I can help.", "ai_style"],
  ])("blocks unsafe output", (draft, code) => {
    expect(validateDraft(draft, { intent: draft.includes("revisions") ? "design_process" : "photo_guidance" }))
      .toMatchObject({ ok: false, codes: [code] });
  });
});
