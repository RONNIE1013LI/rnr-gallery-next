import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sanitizeHumanOutboundText } from "./human-outbound-sanitizer";

describe("human outbound sanitizer", () => {
  it("normalizes safe text and preserves a comparison hash", () => {
    const result = sanitizeHumanOutboundText("  Please send your postcode.  ");

    expect(result).toEqual({
      text: "Please send your postcode.",
      bodyHash: createHash("sha256").update("Please send your postcode.").digest("hex"),
      redactionCodes: [],
      learningEligible: true,
      withheld: false,
    });
  });

  it.each([
    "Please transfer to 12-3456-0789012-00.",
    "My bank account number is 1234567890123456.",
    "Pay with card 4111 1111 1111 1111.",
  ])("withholds payment details instead of partially retaining them: %s", (text) => {
    const result = sanitizeHumanOutboundText(text);

    expect(result.text).toBe("[Sensitive staff reply withheld]");
    expect(result.redactionCodes).toContain("payment_details_withheld");
    expect(result.learningEligible).toBe(false);
    expect(result.withheld).toBe(true);
    expect(result.bodyHash).toBe(createHash("sha256").update(text).digest("hex"));
  });

  it("redacts direct customer contact and order details deterministically", () => {
    const result = sanitizeHumanOutboundText(
      "Hi Maria, email maria@example.com or call +64 21 234 5678 about order RNR-482910.",
    );

    expect(result.text).toBe(
      "Hi there, email [email redacted] or call [phone redacted] about order [order id redacted].",
    );
    expect(result.redactionCodes).toEqual([
      "customer_name_redacted",
      "email_redacted",
      "phone_redacted",
      "order_id_redacted",
    ]);
    expect(result.learningEligible).toBe(false);
  });

  it("redacts a full street address and strips URL query data", () => {
    const result = sanitizeHumanOutboundText(
      "Pickup is 11 Para Close, Fairview Heights. Check https://example.test/track?token=secret&id=4",
    );

    expect(result.text).toBe(
      "Pickup is [address redacted]. Check https://example.test/track",
    );
    expect(result.redactionCodes).toEqual(["address_redacted", "url_query_redacted"]);
    expect(result.learningEligible).toBe(false);
  });

  it("fails closed when no usable text remains", () => {
    expect(sanitizeHumanOutboundText("   ")).toMatchObject({
      text: "[Sensitive staff reply withheld]",
      redactionCodes: ["empty_text_withheld"],
      learningEligible: false,
      withheld: true,
    });
  });
});
