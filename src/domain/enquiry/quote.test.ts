import { describe, expect, it } from "vitest";
import { parseQuote } from "./quote";
const valid = { requestId: "12345678-1234-4234-8234-123456789abc", name: "Example Customer", contactMethod: "email", email: "sample@example.test", phone: "", occasion: "Birthday", product: "photo-print-canvas", size: "A3", requiredDate: "2026-09-15", message: "Please help me choose a canvas.", website: "" };
describe("quote intake validation", () => {
  it("validates conditional contact details and date boundaries", () => {
    expect(parseQuote(valid)).toMatchObject({ success: true });
    expect(parseQuote({ ...valid, email: "invalid" })).toMatchObject({ success: false });
    expect(parseQuote({ ...valid, contactMethod: "phone", email: "", phone: "+64 21 000 0000" })).toMatchObject({ success: true });
    expect(parseQuote({ ...valid, requiredDate: "2026-09-12" })).toMatchObject({ success: true });
    for (const date of ["2026-02-30"]) expect(parseQuote({ ...valid, requiredDate: date })).toMatchObject({ success: false });
  });
  it("rejects overlong, unknown and bot-controlled input", () => {
    for (const patch of [{ message: "x".repeat(1501) }, { website: "spam" }, { product: "unknown-product" }, { recipient: "attacker@example.test" }]) {
      expect(parseQuote({ ...valid, ...patch })).toMatchObject({ success: false });
    }
  });
});
