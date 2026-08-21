import { describe, expect, it } from "vitest";
import { sanitizeWebsiteModelInput } from "./model-input-sanitizer";

describe("Website model input sanitizer", () => {
  it("removes direct identifiers from provider text", () => {
    const raw = [
      "Email me at tina@example.com or call +64 21 123 4567.",
      "Deliver to 11 Para Close, Albany 0632.",
      "Or use PO Box 12345, Auckland.",
      "Order RNR-123456, tracking NZPOST123456789.",
      "See https://carrier.example/track?token=customer-secret#private.",
      "Alternate tracking link https://carrier.example/track/NZPOST987654321.",
      "Reference https://example.com/help?customer=another-secret#private-note.",
    ].join(" ");
    const result = sanitizeWebsiteModelInput(raw);

    expect(result.text).not.toContain("tina@example.com");
    expect(result.text).not.toContain("+64 21 123 4567");
    expect(result.text).not.toContain("11 Para Close");
    expect(result.text).not.toContain("PO Box 12345");
    expect(result.text).not.toContain("RNR-123456");
    expect(result.text).not.toContain("NZPOST123456789");
    expect(result.text).not.toContain("customer-secret");
    expect(result.text).not.toContain("#private");
    expect(result.text).not.toContain("NZPOST987654321");
    expect(result.text).not.toContain("another-secret");
    expect(result.redactionCodes).toEqual(expect.arrayContaining([
      "email", "phone", "address", "order_identifier", "tracking_identifier", "url_parameters",
    ]));
    expect(result).not.toHaveProperty("rawText");
  });

  it("fails closed for payment identifiers", () => {
    const result = sanitizeWebsiteModelInput("My card is 4111 1111 1111 1111 and bank account is 12-3456-0789012-00");
    expect(result.reviewRequired).toBe(true);
    expect(result.text).not.toMatch(/4111|0789012/);
    expect(result.redactionCodes).toContain("payment_identifier");
  });

  it("removes identifiers embedded in ordinary URL paths", () => {
    const result = sanitizeWebsiteModelInput(
      "Please check https://shop.example/orders/ABC123456 and https://example.com/customer/tina-private-profile.",
    );

    expect(result.text).not.toContain("ABC123456");
    expect(result.text).not.toContain("tina-private-profile");
    expect(result.text).toContain("[link removed]");
    expect(result.redactionCodes).toContain("url_identifier");
  });

  it.each([
    "Deliver to Unit 5, 18 Kauri Crescent, Auckland 1024.",
    "The address is 5 State Highway 1, Taupo 3330.",
    "Please send it to RD 2, Pukekohe 2676.",
    "Use 42 Queen Terrace, Brisbane QLD 4000.",
  ])("removes common NZ and AU address formats: %s", (address) => {
    const result = sanitizeWebsiteModelInput(address);

    expect(result.redactionCodes).toContain("address");
    expect(result.text).not.toMatch(/Kauri|Highway|Pukekohe|Queen Terrace|1024|3330|2676|4000/i);
  });

  it("preserves useful non-identifying quote details", () => {
    const result = sanitizeWebsiteModelInput(
      "I need an A3 canvas with 5 photos, a Minecraft theme, for Australia next Saturday.",
    );
    expect(result).toEqual({
      text: "I need an A3 canvas with 5 photos, a Minecraft theme, for Australia next Saturday.",
      redactionCodes: [],
      reviewRequired: false,
    });
  });
});
