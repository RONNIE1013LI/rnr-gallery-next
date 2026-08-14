import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizeAddress } from "@/domain/address/schema";
import { repriceCart } from "@/domain/checkout/reprice-cart";
import {
  buildWebProductionJobSnapshot,
  calculateOrderTotals,
} from "./drizzle-order-repository";

describe("atomic order totals", () => {
  it("rejects a safe product and shipping sum that overflows safe cents", () => {
    expect(() => calculateOrderTotals({
      subtotalExGstCents: Number.MAX_SAFE_INTEGER - 10,
      gstCents: 5,
      totalInclGstCents: Number.MAX_SAFE_INTEGER - 5,
    }, {
      shippingExGstCents: 20,
      shippingGstCents: 3,
      shippingTotalInclGstCents: 23,
    })).toThrow("safe integer cents");
  });
});

describe("web order production job snapshot", () => {
  it("maps all ordered items and the earliest required date without copying money", () => {
    const now = new Date("2026-08-04T00:00:00.000Z");
    const priced = repriceCart({
      version: 1,
      items: [
        {
          clientItemId: randomUUID(),
          productKey: "photo-print-canvas",
          sizeKey: "a4",
          orientation: "landscape",
          peoplePets: 0,
          photoSubmissionMethod: "later",
          designText: "First design",
          notes: "First note",
          neededDate: "2026-08-12",
          urgentServiceConfirmed: false,
          quantity: 1,
          uploadReferences: [],
        },
        {
          clientItemId: randomUUID(),
          productKey: "roll-up-banner",
          sizeKey: "standard",
          peoplePets: 0,
          photoSubmissionMethod: "later",
          designText: "Second design",
          notes: "Second note",
          neededDate: "2026-08-08",
          urgentServiceConfirmed: true,
          quantity: 2,
          uploadReferences: [],
        },
      ],
    }, { now });
    const address = normalizeAddress({
      country: "NZ",
      fullName: "Aroha Ngata",
      building: "",
      street: "12 Queen Street",
      suburb: "Auckland Central",
      region: "Auckland",
      postcode: "1010",
      phone: "021 123 4567",
      email: "AROHA@EXAMPLE.TEST",
    });
    const orderItemIds = [randomUUID(), randomUUID()];

    const snapshot = buildWebProductionJobSnapshot({
      order: { id: randomUUID(), orderNumber: "RNR-2026-ABC123" },
      cart: priced,
      billingAddress: address,
      deliveryAddress: address,
      deliveryMethod: "post",
      orderItemIds,
      now,
    });

    expect(snapshot.job).toEqual(expect.objectContaining({
      jobNumber: "RNR-2026-ABC123",
      source: "web",
      customerName: "Aroha Ngata",
      customerEmail: "AROHA@EXAMPLE.TEST",
      customerPhone: "+64211234567",
      customerSource: "web",
      urgent: true,
      neededDate: "2026-08-08",
      deliveryMethod: "post",
      deliveryAddress: "Aroha Ngata\n12 Queen Street\nAuckland Central\nAuckland\n1010\nNZ",
    }));
    expect(snapshot.job).not.toHaveProperty("amountPayableCents");
    expect(snapshot.items).toEqual([
      expect.objectContaining({
        position: 0,
        sourceOrderItemId: orderItemIds[0],
        productTitle: "Photo Print Canvas",
        sizeLabel: "A4 — 29.7 × 21 cm",
        quantity: 1,
      }),
      expect.objectContaining({
        position: 1,
        sourceOrderItemId: orderItemIds[1],
        productTitle: "Roll-Up Banner",
        sizeLabel: "85 × 200 cm",
        quantity: 2,
      }),
    ]);
  });
});
