import { describe, expect, it } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { preflightMarketSwitch } from "./market-switch-preflight";

const NOW = new Date("2026-08-24T00:00:00.000Z");
const FIRST_ID = "00000000-0000-4000-8000-000000000010";
const SECOND_ID = "00000000-0000-4000-8000-000000000011";

function enabledAuRegistry() {
  const registry = structuredClone(defaultProductRegistry);
  const australia = registry.markets.AU;
  for (const product of australia.products) {
    for (const size of product.sizes) size.amountInclTaxCents = 40_000;
    for (const charge of product.charges) charge.amountInclTaxCents = 2_000;
  }
  for (const fee of australia.peoplePets.fees) fee.amountInclTaxCents = 5_000;
  australia.peoplePets.additionalEachInclTaxCents = 3_000;
  for (const fee of australia.urgentServiceFees) fee.amountInclTaxCents = 9_000;
  australia.enabled = true;
  return registry;
}

function item(clientItemId: string, overrides: Record<string, unknown> = {}) {
  return {
    clientItemId,
    productKey: "custom-themed-canvas",
    sizeKey: "a3",
    orientation: "landscape",
    peoplePets: 0,
    photoSubmissionMethod: "upload",
    designText: "Family portrait",
    notes: "Warm colours",
    neededDate: "2026-08-28",
    urgentServiceConfirmed: false,
    quantity: 1,
    uploadReferences: [
      clientItemId.replace("010", "001").replace("011", "002"),
    ],
    ...overrides,
  };
}

function cart(items = [item(FIRST_ID), item(SECOND_ID)]) {
  return { version: 1, items };
}

describe("market-switch target-market preflight", () => {
  it("reports every unconfirmed urgent item using authoritative target-market data", () => {
    const result = preflightMarketSwitch(cart(), {
      now: NOW,
      registry: enabledAuRegistry(),
      market: "AU",
      registryRevision: 9,
    });

    expect(result).toEqual({
      result: "urgent_confirmation_required",
      issues: [
        expect.objectContaining({
          clientItemId: FIRST_ID,
          productTitle: "Custom Themed Canvas",
          neededDate: "2026-08-28",
          currency: "AUD",
          urgentFeeInclGstCents: expect.any(Number),
        }),
        expect.objectContaining({ clientItemId: SECOND_ID, currency: "AUD" }),
      ],
    });
  });

  it("returns the ordinary repriced cart when no confirmation is needed", () => {
    const value = cart([item(FIRST_ID, {
      urgentServiceConfirmed: true,
    })]);
    const result = preflightMarketSwitch(value, { now: NOW });

    expect(result).toMatchObject({ result: "ready", cart: { market: "NZ" } });
    if (result.result === "ready") {
      expect(result.cart.items[0].urgentServiceConfirmed).toBe(true);
    }
  });

  it("returns ready for a valid completion date beyond the urgent fee bands", () => {
    const result = preflightMarketSwitch(cart([item(FIRST_ID, {
      neededDate: "2026-09-24",
    })]), {
      now: NOW,
      registry: enabledAuRegistry(),
      market: "AU",
      registryRevision: 9,
    });

    expect(result).toMatchObject({
      result: "ready",
      cart: {
        market: "AU",
        currency: "AUD",
        totalInclGstCents: 40_000,
        items: [{ urgentServiceConfirmed: false, urgentService: { feeInclGstCents: 0 } }],
      },
    });
  });

  it("preserves already-confirmed items while reporting only unconfirmed items", () => {
    const result = preflightMarketSwitch(cart([
      item(FIRST_ID, { urgentServiceConfirmed: true }),
      item(SECOND_ID),
    ]), { now: NOW, registry: enabledAuRegistry(), market: "AU" });

    expect(result).toMatchObject({
      result: "urgent_confirmation_required",
      issues: [{ clientItemId: SECOND_ID }],
    });
  });

  it.each([
    ["malformed", { version: 1, items: [] }],
    ["unavailable", cart([item(FIRST_ID, { productKey: "not-a-product" })])],
  ])("propagates %s cart errors", (_label, value) => {
    expect(() => preflightMarketSwitch(value, { now: NOW })).toThrow();
  });
});
