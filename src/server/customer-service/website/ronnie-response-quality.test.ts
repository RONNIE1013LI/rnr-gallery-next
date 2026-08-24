import { describe, expect, it } from "vitest";
import type { CustomerServiceIntent } from "../intent-detection";
import { parseWebsiteDecision, renderWebsiteDecision } from "./structured-decision";

function render(decision: Record<string, unknown>, intent: CustomerServiceIntent, messageText = "") {
  const parsed = parseWebsiteDecision(JSON.stringify(decision));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("expected schema-valid Website decision");
  const result = renderWebsiteDecision({
    decision: parsed.decision,
    expectedIntent: intent,
    productCategory: null,
    messageText,
    acknowledgementAllowed: false,
  });
  expect(result.ok).toBe(true);
  if (!result.ok || result.outcome !== "rendered") throw new Error("expected rendered Website response");
  return result.text;
}

function decision(input: Readonly<{
  responseType?: string;
  intent: CustomerServiceIntent;
  facts?: readonly string[];
  fields?: readonly string[];
}>) {
  return {
    response_type: input.responseType ?? "ANSWER_SAFE",
    intent: input.intent,
    product_type: "UNSPECIFIED",
    missing_fields: input.fields ?? [],
    follow_up_fields: input.fields ?? [],
    allowed_facts: input.facts ?? [],
    human_review_reason: "NONE",
  };
}

describe("Ronnie-approved Website response quality", () => {
  it("directly recommends a roll-up banner for a freestanding display", () => {
    expect(render(decision({
      intent: "product_differences",
      facts: ["ROLL_UP_FREESTANDING_RECOMMENDATION"],
    }), "product_differences")).toBe(
      "For a freestanding display, I’d recommend the Roll-up Banner. It comes with its own stand, so it’s easy to set up and move without needing a wall.",
    );
  });

  it("clarifies a vague opening without escalating", () => {
    expect(render(decision({
      intent: "tone_adjustment",
      facts: ["OPEN_HELP_CLARIFICATION"],
    }), "tone_adjustment")).toBe("Of course 😊 What can I help you with?");
  });

  it("answers a permanent-keepsake question directly", () => {
    expect(render(decision({
      intent: "product_differences",
      facts: ["CANVAS_PERMANENT_KEEPSAKE_RECOMMENDATION"],
    }), "product_differences")).toBe(
      "Yes. Canvas is a good option for a permanent keepsake, especially if you’d like something designed for long-term wall display.",
    );
  });

  it("collects the remaining quote details and makes delivery location conditional", () => {
    expect(render(decision({
      responseType: "ANSWER_AND_ASK",
      intent: "quote_information_collection",
      facts: ["A3_SIZE_NOTED"],
      fields: ["PEOPLE_COUNT", "PHOTO_COUNT", "REQUIRED_DATE", "DELIVERY_LOCATION_IF_REQUIRED"],
    }), "quote_information_collection", "A3")).toBe(
      "Thanks, A3 noted 😊 About how many people and photos would you like to include, and what date do you need it for? If delivery is required, please also send your suburb or postcode.",
    );
  });

  it("uses natural customer language for combining photos", () => {
    expect(render(decision({
      intent: "photo_guidance",
      facts: ["PHOTO_COMBINE_SUBJECTS"],
    }), "photo_guidance")).toBe(
      "Yes, we can combine people or pets from different photos into one design. Please send the original photos where possible so we can check the quality and let you know what will work best.",
    );
  });

  it("acknowledges supplied wording before asking the next design questions", () => {
    expect(render(decision({
      responseType: "ANSWER_AND_ASK",
      intent: "design_process",
      facts: ["HAPPY_50TH_BIRTHDAY_MUM_WORDING_NOTED"],
      fields: ["THEME", "COLOUR_PREFERENCES"],
    }), "design_process", "Happy 50th Birthday Mum")).toBe(
      "Perfect, “Happy 50th Birthday Mum” noted 😊 What theme or background style would you like? If you have any preferred colours, please let us know as well.",
    );
  });

  it("fails closed when a model selects a specific acknowledgement absent from the customer message", () => {
    const parsed = parseWebsiteDecision(JSON.stringify(decision({
      responseType: "ANSWER_AND_ASK",
      intent: "quote_information_collection",
      facts: ["A3_SIZE_NOTED"],
      fields: ["PEOPLE_COUNT"],
    })));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected schema-valid Website decision");
    expect(renderWebsiteDecision({
      decision: parsed.decision,
      expectedIntent: "quote_information_collection",
      productCategory: null,
      messageText: "A1",
      acknowledgementAllowed: false,
    })).toEqual({ ok: false, code: "website_decision_incompatible" });
  });
});
