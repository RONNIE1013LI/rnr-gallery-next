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

  it("redacts a customer name after a thank-you greeting", () => {
    const result = sanitizeHumanOutboundText("Thanks Maria, please send the original photo.");
    expect(result.text).toBe("Thanks there, please send the original photo.");
    expect(result.redactionCodes).toContain("customer_name_redacted");
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

  it("redacts Australian phone numbers, extended address suffixes and embedded family names", () => {
    const result = sanitizeHumanOutboundText(
      "This is for my son Kaitiaki. Call +61 412 345 678 or collect from 12 Sample Terrace.",
    );

    expect(result.text).toBe(
      "This is for my son [name]. Call [phone redacted] or collect from [address redacted].",
    );
    expect(result.redactionCodes).toEqual([
      "customer_name_redacted",
      "phone_redacted",
      "address_redacted",
    ]);
    expect(result.learningEligible).toBe(false);
  });

  it("fails closed for international contact details, PO boxes and names in free-form replies", () => {
    const result = sanitizeHumanOutboundText(
      "Call +1 (202) 555-0100 or send it to PO Box 123, Sydney. Please ask for Olivia.",
    );

    expect(result.text).not.toMatch(/202|PO Box 123|Olivia/);
    expect(result.redactionCodes).toEqual(expect.arrayContaining([
      "phone_redacted",
      "address_redacted",
      "customer_name_redacted",
    ]));
    expect(result.learningEligible).toBe(false);
  });

  it("fails closed for unprefixed phone numbers and customer-prefixed names", () => {
    const result = sanitizeHumanOutboundText(
      "Customer Sarah can call 202 555 0100 after reviewing the draft.",
    );
    expect(result.text).not.toMatch(/Sarah|202 555 0100/);
    expect(result.redactionCodes).toEqual(expect.arrayContaining([
      "customer_name_redacted",
      "phone_redacted",
    ]));
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

  it("stores attachment-only staff replies as a non-learning marker", () => {
    expect(sanitizeHumanOutboundText("[Staff sent an attachment]")).toMatchObject({
      text: "[Staff sent an attachment]",
      learningEligible: false,
      withheld: true,
      redactionCodes: ["attachment_only_withheld"],
    });
  });
});
