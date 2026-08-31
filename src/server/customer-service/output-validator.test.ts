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

  it("accepts only an exact monetary amount supplied by the current pricing source", () => {
    expect(validateDraft(
      "The current Roll-Up Banner price is NZ$264.50.",
      {
        intent: "quote_information_collection",
        approvedPrices: [{ currency: "NZD", amountInclTaxCents: 26_450 }],
      },
    )).toEqual({ ok: true, codes: [] });

    expect(validateDraft(
      "The current Roll-Up Banner price is NZ$299.00.",
      {
        intent: "quote_information_collection",
        approvedPrices: [{ currency: "NZD", amountInclTaxCents: 26_450 }],
      },
    )).toEqual({ ok: false, codes: ["monetary_claim"] });
  });

  it.each([
    "The price is 299.00 NZD.",
    "The price is 299 NZ dollars.",
    "The price is AUD $264.50.",
    "The price is USD $264.50.",
    "The price is US$264.50.",
    "The price is AU $264.50.",
    "The price is Australian $264.50.",
    "The price is 264.50 USD.",
    "The price is 264.50 US dollars.",
  ])("rejects wrong or conflicting currency formats: %s", (draft) => {
    expect(validateDraft(draft, {
      intent: "quote_information_collection",
      approvedPrices: [{ currency: "NZD", amountInclTaxCents: 26_450 }],
    })).toEqual({ ok: false, codes: ["monetary_claim"] });
  });
});
