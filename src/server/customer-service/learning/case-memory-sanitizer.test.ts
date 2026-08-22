import { describe, expect, it } from "vitest";
import { sanitizeCaseMemoryText } from "./case-memory-sanitizer";

describe("case memory sanitizer", () => {
  it("removes private and realtime customer data from reusable text", () => {
    const result = sanitizeCaseMemoryText(
      "Jane, email jane@example.com or call 021 234 5678. Deliver to 11 Para Close, Albany 0632. Order RNR-ABCD123 costs NZ$189.75.",
    );
    expect(result.text).not.toMatch(/Jane|jane@example|021|Para Close|0632|RNR-ABCD123|189\.75/);
    expect(result.safe).toBe(false);
    expect(result.codes).toEqual(expect.arrayContaining([
      "name_redacted", "email_redacted", "phone_redacted", "address_redacted", "postcode_redacted", "order_id_redacted", "realtime_value_redacted",
    ]));
  });

  it("leaves a generic process explanation reusable", () => {
    expect(sanitizeCaseMemoryText("Please send your photos, wording and theme."))
      .toEqual({ text: "Please send your photos, wording and theme.", codes: [], safe: true });
    expect(sanitizeCaseMemoryText("Customer asks how the design process works."))
      .toEqual({ text: "Customer asks how the design process works.", codes: [], safe: true });
  });

  it.each([
    "My name is Kaitiaki and the event is in November.",
    "His name is Tama. Please use a blue theme.",
    "Thanks Maria, please send the original photo.",
    "Hello Aroha, we can prepare a draft.",
    "This is for my son Kaitiaki and his birthday.",
  ])("removes names embedded in common customer-service phrases: %s", (value) => {
    const result = sanitizeCaseMemoryText(value);
    expect(result.text).not.toMatch(/Kaitiaki|Tama|Maria|Aroha/);
    expect(result.codes).toContain("name_redacted");
    expect(result.safe).toBe(false);
  });

  it("removes Australian contact details and additional street suffixes", () => {
    const result = sanitizeCaseMemoryText(
      "Call +61 412 345 678 or deliver to 9 Example Terrace, Brisbane 4000.",
    );
    expect(result.text).not.toMatch(/412 345 678|Example Terrace|4000/);
    expect(result.codes).toEqual(expect.arrayContaining(["phone_redacted", "address_redacted", "postcode_redacted"]));
    expect(result.safe).toBe(false);
  });

  it("fails closed for international numbers, PO boxes and free-form recipient names", () => {
    const result = sanitizeCaseMemoryText(
      "Call +44 20 7946 0958, post to PO Box 91, London, and ask for Olivia.",
    );
    expect(result.text).not.toMatch(/7946|PO Box 91|Olivia/);
    expect(result.codes).toEqual(expect.arrayContaining([
      "phone_redacted",
      "address_redacted",
      "name_redacted",
    ]));
    expect(result.safe).toBe(false);
  });

  it("fails closed for unprefixed numbers and residual proper names", () => {
    const result = sanitizeCaseMemoryText(
      "Customer Sarah can call 202 555 0100 after reviewing the draft.",
    );
    expect(result.text).not.toMatch(/Sarah|202 555 0100/);
    expect(result.codes).toEqual(expect.arrayContaining(["name_redacted", "phone_redacted"]));
    expect(result.safe).toBe(false);
  });
});
