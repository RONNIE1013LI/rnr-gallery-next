import { describe, expect, it } from "vitest";
import { detectIntent } from "./intent-detection";

describe("customer service intent detection", () => {
  it.each([
    ["Which product format should I choose?", "product_differences"],
    ["What details do you need to prepare a quote?", "quote_information_collection"],
    ["Can you use my blurry original photo?", "photo_guidance"],
    ["What happens during the design process?", "design_process"],
    ["How is the canvas produced?", "production_process"],
    ["How does the deposit process work?", "payment_process"],
    ["How many free revisions do I get?", "revision_policy"],
    ["Hi there", "tone_adjustment"],
  ] as const)("detects %s", (message, expected) => {
    expect(detectIntent(message)).toBe(expected);
  });

  it("checks a generic banner enquiry before broad live-price matching", () => {
    expect(detectIntent("How much are your banners?")).toBe("quote_information_collection");
  });
});
