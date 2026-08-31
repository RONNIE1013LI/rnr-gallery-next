import { describe, expect, it } from "vitest";
import { detectIntent } from "./intent-detection";

describe("customer service intent detection", () => {
  it.each([
    ["Which product format should I choose?", "product_differences"],
    ["What details do you need to prepare a quote?", "quote_information_collection"],
    ["How much are your products?", "quote_information_collection"],
    ["Can I see your prices?", "quote_information_collection"],
    ["How much is an A1 canvas?", "quote_information_collection"],
    ["What does a roll-up banner cost?", "quote_information_collection"],
    ["What's the price for your banner bundle?", "quote_information_collection"],
    ["Can I get your price list?", "quote_information_collection"],
    ["How much is a Custom Themed Wall Banner 160 x 80 cm?", "quote_information_collection"],
    ["Can you use my blurry original photo?", "photo_guidance"],
    ["Can you combine people from different photographs?", "photo_guidance"],
    ["What happens during the design process?", "design_process"],
    ["Will I see a design draft before printing?", "design_process"],
    ["How is the canvas produced?", "production_process"],
    ["How does the deposit process work?", "payment_process"],
    ["How does payment work before design starts?", "payment_process"],
    ["How many free revisions do I get?", "revision_policy"],
    ["Hi there", "tone_adjustment"],
    ["Can you help me with something?", "tone_adjustment"],
  ] as const)("detects %s", (message, expected) => {
    expect(detectIntent(message)).toBe(expected);
  });

  it("checks a generic banner enquiry before broad live-price matching", () => {
    expect(detectIntent("How much are your banners?")).toBe("quote_information_collection");
  });
});
