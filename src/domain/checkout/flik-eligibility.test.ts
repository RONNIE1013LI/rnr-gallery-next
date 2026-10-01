import { describe, expect, it } from "vitest";
import { flikEligibility } from "./flik-eligibility";

const order = { market: "NZ", currency: "NZD", amountCents: 2500, billingCountry: "NZ", deliveryCountry: "NZ" };
const availability = { enabled: true, configured: true };

describe("Flik eligibility", () => {
  it("accepts a fully identified NZ/NZD order", () => {
    expect(flikEligibility(order, availability)).toEqual({ available: true });
  });
  it.each([
    { market: "AU", currency: "AUD" }, { market: "AU" }, { currency: "AUD" },
    { market: undefined }, { billingCountry: undefined }, { deliveryCountry: undefined },
    { billingCountry: "AU" }, { deliveryCountry: "AU" }, { market: "nz" },
    { amountCents: 0 }, { amountCents: 1.5 }, { amountCents: 1000001 }, { amountCents: NaN },
  ])("rejects missing, conflicting or unsupported order data %o", (change) => {
    expect(flikEligibility({ ...order, ...change }, availability).available).toBe(false);
  });
  it.each([{ enabled: false, configured: true }, { enabled: true, configured: false }])("requires configuration and enablement", (flags) => {
    expect(flikEligibility(order, flags)).toEqual({ available: false, reason: "configuration" });
  });
});
