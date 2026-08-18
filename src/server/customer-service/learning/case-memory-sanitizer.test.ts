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
  });
});
