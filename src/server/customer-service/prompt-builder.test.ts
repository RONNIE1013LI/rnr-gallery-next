import { describe, expect, it } from "vitest";
import { buildDraftPrompt } from "./prompt-builder";

describe("customer service prompt builder", () => {
  it("uses bounded same-customer context and confirmed selected rules", () => {
    const prompt = buildDraftPrompt({
      intent: "photo_guidance",
      context: ["My photo is blurry", "Can you check it?"],
      rules: [{ id: "AI-SCOPE-05", text: "Request the original and offer assessment." }],
      examples: [{ customer: "Can you use this?", reply: "Please send the original." }],
      goldenExamples: [{
        customerQuestion: "Can you use blurry photos?",
        approvedAnswer: "Please send the original file so we can assess it before confirming what is possible.",
      }],
      qualityGuide: {
        intent: "photo_guidance",
        minimumRequiredContent: ["Request the original file", "Explain that results depend on source quality"],
        recommendedDetailLevel: "Two concise paragraphs.",
        preferredStructure: ["Answer", "Limit", "Next step"],
        usefulFollowUpQuestions: ["Please send the original file for assessment."],
        forbiddenClaims: ["Do not guarantee restoration or print suitability before review."],
        requiredPoints: [
          { id: "original_file", description: "Request the original file", matchAny: ["original file", "original image"] },
        ],
        knowledgeRuleIds: ["AI-SCOPE-05", "PHOTO-01"],
      },
      toneGuide: "Short, warm and practical.",
    });
    expect(prompt.instructions).toContain("AI-SCOPE-05");
    expect(prompt.input).toContain("My photo is blurry");
    expect(prompt.input).toContain("Can you check it?");
    expect(prompt.instructions).toContain("Never send");
    expect(prompt.instructions).toContain("MINIMUM REQUIRED CONTENT");
    expect(prompt.instructions).toContain("Request the original file");
    expect(prompt.instructions).toContain("FORBIDDEN CLAIMS");
    expect(prompt.instructions).toContain("RONNIE-APPROVED GOLDEN EXAMPLES");
    expect(prompt.instructions).toContain("Can you use blurry photos?");
    expect(prompt.instructions).toContain("maximum of five non-empty lines");
    expect(prompt.instructions).toContain("uses its own stand");
    expect(prompt.instructions).toContain("do not use the word \"guarantee\"");
  });
});
