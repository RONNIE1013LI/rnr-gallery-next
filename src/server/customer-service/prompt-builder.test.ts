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

  it("keeps the frozen text-only prompt byte-for-byte unchanged", () => {
    const prompt = buildDraftPrompt({
      intent: "photo_guidance",
      context: ["My photo is blurry"],
      rules: [{ id: "AI-SCOPE-05", text: "Request the original and offer assessment." }],
      examples: [],
      goldenExamples: [],
      qualityGuide: null,
      toneGuide: "Short, warm and practical.",
    });
    expect(prompt).toEqual({
      instructions: [
        "Write one specific, information-dense R&R Gallery customer-service draft in natural English.",
        "This is a suggestion for human review. Never send or claim that it was sent.",
        "Use only the confirmed rules below as business facts.",
        "Do not quote live prices, dates, availability, order data or unconfirmed policy.",
        "Cover every relevant required point. If a point is not relevant to the customer's exact question, omit it rather than forcing unrelated detail.",
        "Use a maximum of five non-empty lines and 800 characters, restrained emoji and one useful next step.",
        "For product hardware, use safe descriptive wording such as 'hangs with eyelets' or 'uses its own stand'; do not say 'includes', 'comes with', 'has' or 'provided with' around hardware.",
        "For photo quality, do not use the word \"guarantee\", even in a negative sentence. Say results depend on the original and can only be assessed after reviewing the file.",
        "When a process detail is not confirmed, keep that detail neutral; do not remove the rest of the confirmed process.",
        "Do not mention AI, policy status, internal risk or the knowledge base.",
        "Detected intent: photo_guidance",
        "CONFIRMED RULES:\nAI-SCOPE-05: Request the original and offer assessment.",
        "MINIMUM REQUIRED CONTENT:\n- Answer only with confirmed facts.",
        "RECOMMENDED DETAIL LEVEL:\nKeep the answer concise and specific.",
        "PREFERRED STRUCTURE:\n- Direct answer\n- Useful next step",
        "USEFUL FOLLOW-UP OPTIONS:\n- Ask one useful question when needed.",
        "FORBIDDEN CLAIMS:\n- Do not add unconfirmed facts.",
        "TONE GUIDE:\nShort, warm and practical.",
        "RONNIE-APPROVED GOLDEN EXAMPLES:\n",
        "OLDER STYLE EXAMPLES ONLY:\n",
      ].join("\n\n"),
      input: "Current same-customer conversation:\n1. My photo is blurry\nReturn only the proposed customer reply.",
    });
  });

  it("labels customer and staff history without accepting a conversation selector", () => {
    const prompt = buildDraftPrompt({
      intent: "quote_information_collection",
      context: [
        { role: "staff", text: "Which country are you in?", receivedAt: "2026-08-18T00:00:00.000Z" },
        { role: "customer", text: "Australia", receivedAt: "2026-08-18T00:00:01.000Z" },
      ],
      rules: [],
      examples: [],
      goldenExamples: [],
      qualityGuide: null,
      toneGuide: "Warm.",
    });

    expect(prompt.input).toContain("1. R&R staff: Which country are you in?");
    expect(prompt.input).toContain("2. Customer: Australia");
    expect(prompt.input).not.toMatch(/conversation[-_ ]?id|sender[-_ ]?id/i);
  });

  it("adds a bounded advisory visual section without bytes or URLs", () => {
    const prompt = buildDraftPrompt({
      intent: "photo_guidance",
      context: ["Can you use this?"],
      rules: [],
      examples: [],
      goldenExamples: [],
      qualityGuide: null,
      toneGuide: "Warm.",
      visualAssessment: "Image 0 appears to be a screenshot; request the original file.",
    });
    expect(prompt.instructions).toContain(
      "VISUAL ASSESSMENT:\nImage 0 appears to be a screenshot; request the original file.",
    );
    expect(prompt.instructions).toContain("advisory");
    expect(prompt.instructions).toContain("cannot establish print suitability");
    expect(prompt.instructions).toContain("cannot support a restoration guarantee");
    expect(JSON.stringify(prompt)).not.toMatch(/https?:|base64|image_url|private-image/i);
  });
});
