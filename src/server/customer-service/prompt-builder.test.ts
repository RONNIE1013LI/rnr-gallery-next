import { describe, expect, it } from "vitest";
import { buildDraftPrompt } from "./prompt-builder";

describe("customer service prompt builder", () => {
  it("uses bounded same-customer context and confirmed selected rules", () => {
    const prompt = buildDraftPrompt({
      intent: "photo_guidance",
      context: ["My photo is blurry", "Can you check it?"],
      rules: [{ id: "AI-SCOPE-05", text: "Request the original and offer assessment." }],
      examples: [{ customer: "Can you use this?", reply: "Please send the original." }],
      toneGuide: "Short, warm and practical.",
    });
    expect(prompt.instructions).toContain("AI-SCOPE-05");
    expect(prompt.input).toContain("My photo is blurry");
    expect(prompt.input).toContain("Can you check it?");
    expect(prompt.instructions).toContain("Never send");
  });
});
