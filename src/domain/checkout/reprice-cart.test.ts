import { describe, expect, it } from "vitest";
import { getConfigurationSchema } from "@/domain/configuration/schemas";
import { InvalidCheckoutCartError } from "./types";
import { repriceCart } from "./reprice-cart";

const MONDAY_IN_AUCKLAND = new Date("2026-08-02T12:00:00.000Z");
const UPLOAD_ID = "00000000-0000-4000-8000-000000000001";

function item(overrides: Record<string, unknown> = {}) {
  return {
    clientItemId: "00000000-0000-4000-8000-000000000010",
    productKey: "photo-print-canvas",
    sizeKey: "a4",
    orientation: "landscape",
    peoplePets: 0,
    photoSubmissionMethod: "upload",
    designText: "Family portrait",
    notes: "Warm colours",
    neededDate: "2026-08-10",
    urgentServiceConfirmed: false,
    quantity: 1,
    uploadReferences: [UPLOAD_ID],
    ...overrides,
  };
}

function cart(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    items: [item(overrides)],
  };
}

function withA4RegistryPrice(priceExGstCents: number, assertion: () => void) {
  const schema = getConfigurationSchema("photo-print-canvas")!;
  const size = schema.sizes.find((candidate) => candidate.key === "a4")! as {
    priceExGstCents: number;
  };
  const originalPrice = size.priceExGstCents;

  try {
    size.priceExGstCents = priceExGstCents;
    assertion();
  } finally {
    size.priceExGstCents = originalPrice;
  }
}

describe("authoritative checkout repricing", () => {
  it("ignores browser money and labels and resolves canonical product data", () => {
    const result = repriceCart(
      cart({
        productTitle: "Free canvas",
        productSlug: "tampered",
        sizeLabel: "Any size",
        urgentFeeInclGstCents: 1,
        price: {
          lines: [],
          subtotalExGstCents: 0,
          gstCents: 0,
          totalInclGstCents: 0,
        },
      }),
      { now: MONDAY_IN_AUCKLAND },
    );

    expect(result.items[0]).toMatchObject({
      productKey: "photo-print-canvas",
      productSlug: "photo-print-canvas",
      productTitle: "Photo Print Canvas",
      sizeKey: "a4",
      sizeLabel: "A4 — 29.7 × 21 cm",
      quantity: 1,
      unitPrice: {
        subtotalExGstCents: 6_500,
        gstCents: 975,
        totalInclGstCents: 7_475,
      },
      lineSubtotalExGstCents: 6_500,
      lineGstCents: 975,
      lineTotalInclGstCents: 7_475,
    });
    expect(result.items[0].unitPrice.lines).toEqual([
      {
        key: "product-size",
        label: "Product / size price",
        amountExGstCents: 6_500,
      },
    ]);
    expect(result).toMatchObject({
      orderDate: "2026-08-03",
      subtotalExGstCents: 6_500,
      gstCents: 975,
      totalInclGstCents: 7_475,
      itemCount: 1,
    });
    expect(result.items[0]).not.toHaveProperty("price");
    expect(result.items[0]).not.toHaveProperty("urgentFeeInclGstCents");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.items)).toBe(true);
    expect(Object.isFrozen(result.items[0])).toBe(true);
  });

  it.each([
    ["unknown product", { productKey: "not-a-product" }],
    ["unknown size", { sizeKey: "not-a-size" }],
    ["missing choice orientation", { orientation: undefined }],
    ["invalid fixed orientation", {
      productKey: "grave-cover",
      sizeKey: "standard",
      orientation: "landscape",
    }],
    ["orientation where none is offered", {
      productKey: "roll-up-banner",
      sizeKey: "standard",
      orientation: "portrait",
    }],
    ["people count on a fixed-price product", { peoplePets: 1 }],
    ["missing people count on a portrait product", {
      productKey: "digital-oil-painting-canvas",
      peoplePets: 0,
    }],
    ["missing required upload", { uploadReferences: [] }],
    ["upload references when sending later", {
      photoSubmissionMethod: "later",
      uploadReferences: [UPLOAD_ID],
    }],
  ])("rejects %s", (_label, overrides) => {
    expect(() =>
      repriceCart(cart(overrides), { now: MONDAY_IN_AUCKLAND }),
    ).toThrow(InvalidCheckoutCartError);
  });

  it.each([0, 1.5, 6])("rejects quantity %s outside the cart boundary", (quantity) => {
    expect(() =>
      repriceCart(cart({ quantity }), { now: MONDAY_IN_AUCKLAND }),
    ).toThrow(InvalidCheckoutCartError);
  });

  it.each([21, Number.MAX_SAFE_INTEGER])(
    "rejects unsafe people or pets count %s",
    (peoplePets) => {
      expect(() =>
        repriceCart(
          cart({ productKey: "digital-oil-painting-canvas", peoplePets }),
          { now: MONDAY_IN_AUCKLAND },
        ),
      ).toThrow(InvalidCheckoutCartError);
    },
  );

  it("rejects duplicate client item IDs", () => {
    const duplicate = item({
      photoSubmissionMethod: "later",
      uploadReferences: [],
    });

    expect(() =>
      repriceCart(
        { version: 1, items: [duplicate, duplicate] },
        { now: MONDAY_IN_AUCKLAND },
      ),
    ).toThrow("Client item IDs must be unique");
  });

  it("rejects one upload referenced by different cart items", () => {
    expect(() =>
      repriceCart({
        version: 1,
        items: [
          item(),
          item({ clientItemId: "00000000-0000-4000-8000-000000000011" }),
        ],
      }, { now: MONDAY_IN_AUCKLAND }),
    ).toThrow("Upload references cannot be shared between cart items");
  });

  it("rejects unsafe computed money from the canonical registry", () => {
    withA4RegistryPrice(Number.MAX_SAFE_INTEGER, () => {
      expect(() =>
        repriceCart(cart(), { now: MONDAY_IN_AUCKLAND }),
      ).toThrow("safe integer cents");
    });
  });

  it("rejects a safe unit amount that overflows its quantity line", () => {
    withA4RegistryPrice(1_700_000_000_000_000, () => {
      expect(() =>
        repriceCart(cart({ quantity: 5 }), { now: MONDAY_IN_AUCKLAND }),
      ).toThrow("Line price");
    });
  });

  it("rejects safe item lines whose cart sum overflows", () => {
    const items = Array.from({ length: 8 }, (_, index) =>
      item({
        clientItemId: `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
        photoSubmissionMethod: "later",
        quantity: 5,
        uploadReferences: [],
      }),
    );

    withA4RegistryPrice(200_000_000_000_000, () => {
      expect(() =>
        repriceCart({ version: 1, items }, { now: MONDAY_IN_AUCKLAND }),
      ).toThrow("Cart price");
    });
  });

  it.each([
    ["2026-08-04", 1, 8_000, 6_957, 20_075],
    ["2026-08-05", 2, 7_000, 6_087, 19_075],
    ["2026-08-06", 3, 6_000, 5_217, 18_075],
    ["2026-08-07", 4, 5_000, 4_348, 17_075],
    ["2026-08-10", 5, 0, 0, 12_075],
  ])(
    "recalculates %s as working day %i with urgent fee %i",
    (
      neededDate,
      workingDays,
      feeInclGstCents,
      feeExGstCents,
      totalInclGstCents,
    ) => {
      const result = repriceCart(
        cart({
          productKey: "digital-oil-painting-canvas",
          peoplePets: 1,
          neededDate,
          urgentServiceConfirmed: feeInclGstCents > 0,
        }),
        { now: MONDAY_IN_AUCKLAND },
      );

      expect(result.items[0].urgentService).toEqual({
        workingDays,
        feeInclGstCents,
      });
      expect(result.items[0].unitPrice.totalInclGstCents).toBe(totalInclGstCents);
      expect(
        result.items[0].unitPrice.lines.find((line) => line.key === "urgent-service"),
      ).toEqual(
        feeInclGstCents === 0
          ? undefined
          : {
              key: "urgent-service",
              label: "Urgent service",
              amountExGstCents: feeExGstCents,
              amountInclGstCents: feeInclGstCents,
            },
      );
    },
  );

  it.each([undefined, false])(
    "rejects a fee-bearing date unless urgent confirmation is exactly true: %s",
    (urgentServiceConfirmed) => {
      expect(() =>
        repriceCart(
          cart({ neededDate: "2026-08-07", urgentServiceConfirmed }),
          { now: MONDAY_IN_AUCKLAND },
        ),
      ).toThrow("Urgent service must be confirmed");
    },
  );

  it("multiplies authoritative unit amounts by quantity", () => {
    const result = repriceCart(cart({ quantity: 2 }), {
      now: MONDAY_IN_AUCKLAND,
    });

    expect(result.items[0]).toMatchObject({
      lineSubtotalExGstCents: 13_000,
      lineGstCents: 1_950,
      lineTotalInclGstCents: 14_950,
    });
    expect(result).toMatchObject({
      subtotalExGstCents: 13_000,
      gstCents: 1_950,
      totalInclGstCents: 14_950,
      itemCount: 2,
    });
  });

  it("keeps the digest stable for ignored browser fields and changes it for selections", () => {
    const original = repriceCart(cart(), { now: MONDAY_IN_AUCKLAND });
    const tampered = repriceCart(
      cart({
        productTitle: "Tampered",
        urgentFeeInclGstCents: Number.MAX_VALUE,
        price: {
          subtotalExGstCents: Number.MAX_VALUE,
          gstCents: Number.MAX_VALUE,
          totalInclGstCents: Number.MAX_VALUE,
        },
      }),
      { now: MONDAY_IN_AUCKLAND },
    );
    const changed = repriceCart(cart({ quantity: 2 }), {
      now: MONDAY_IN_AUCKLAND,
    });

    expect(original.cartDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(tampered.cartDigest).toBe(original.cartDigest);
    expect(changed.cartDigest).not.toBe(original.cartDigest);
  });
});
