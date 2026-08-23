import { z } from "zod";
import type { Market } from "@/domain/markets/types";

const MAX_PRICE_CENTS = 100_000_000;
const cents = z.number().int().min(0).max(MAX_PRICE_CENTS);
const priceCell = cents.nullable();

export type MarketPriceCell = number | null;

export type MarketChargeKey =
  | "extra-photo"
  | "background-removal"
  | "roll-up-extra-photo"
  | "roll-up-background-removal"
  | "wall-banner-extra-photo"
  | "wall-banner-background-removal";

export type MarketProductPrice = {
  productKey: string;
  sizes: Array<{ sizeKey: string; amountInclTaxCents: MarketPriceCell }>;
  charges: Array<{
    key: MarketChargeKey;
    amountInclTaxCents: MarketPriceCell;
  }>;
};

export type MarketShippingPrice = {
  key: string;
  label: string;
  method: "pickup" | "post";
  source: "fixed" | "carrier";
  active: boolean;
  amountInclTaxCents: MarketPriceCell;
};

export type MarketPriceBook = {
  market: Market;
  currency: "NZD" | "AUD";
  enabled: boolean;
  tax: {
    registered: boolean;
    rateBasisPoints: number;
  };
  products: MarketProductPrice[];
  peoplePets: {
    fees: Array<{ count: number; amountInclTaxCents: MarketPriceCell }>;
    additionalEachInclTaxCents: MarketPriceCell;
  };
  urgentServiceFees: Array<{
    workingDays: number;
    amountInclTaxCents: MarketPriceCell;
  }>;
  designSurcharges: Array<{ key: string; amountInclTaxCents: MarketPriceCell }>;
  discounts: Array<{ key: string; amountInclTaxCents: MarketPriceCell }>;
  shippingMethods: MarketShippingPrice[];
};

export type MarketPriceBooks = {
  NZ: MarketPriceBook & { market: "NZ"; currency: "NZD" };
  AU: MarketPriceBook & { market: "AU"; currency: "AUD" };
};

export const AUSTRALIA_FIXED_SHIPPING_METHODS: MarketShippingPrice[] = [
  {
    key: "au-standard",
    label: "Standard Shipping",
    method: "post",
    source: "fixed",
    active: true,
    amountInclTaxCents: null,
  },
  {
    key: "au-dhl-express",
    label: "DHL Express",
    method: "post",
    source: "fixed",
    active: true,
    amountInclTaxCents: null,
  },
];

type LegacyRegistryShape = {
  products: Array<{
    key: string;
    configuration: {
      sizes: Array<{
        key: string;
        priceExGstCents: number;
        nzAmountInclTaxCents?: number;
      }>;
      extraPhotoPriceExGstCents?: number;
      extraBackgroundRemovalFeeInclGstCents?: number;
    };
  }>;
  pricing: {
    peoplePetsFeesExGstCents: number[];
    additionalPeoplePetsEachExGstCents: number;
    urgentServiceFeesInclGstCents: number[];
  };
};

type RegistryWithMarkets = LegacyRegistryShape & { markets: MarketPriceBooks };

const productPriceSchema = z.object({
  productKey: z.string().min(1).max(120),
  sizes: z.array(z.object({
    sizeKey: z.string().min(1).max(120),
    amountInclTaxCents: priceCell,
  }).strict()).min(1),
  charges: z.array(z.object({
    key: z.enum([
      "extra-photo",
      "background-removal",
      "roll-up-extra-photo",
      "roll-up-background-removal",
      "wall-banner-extra-photo",
      "wall-banner-background-removal",
    ]),
    amountInclTaxCents: priceCell,
  }).strict()),
}).strict();

const shippingPriceSchema = z.object({
  key: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(190),
  method: z.enum(["pickup", "post"]),
  source: z.enum(["fixed", "carrier"]),
  active: z.boolean(),
  amountInclTaxCents: priceCell,
}).strict();

function priceBookSchema<MarketLiteral extends "NZ" | "AU", CurrencyLiteral extends "NZD" | "AUD">(
  market: MarketLiteral,
  currency: CurrencyLiteral,
) {
  return z.object({
    market: z.literal(market),
    currency: z.literal(currency),
    enabled: z.boolean(),
    tax: z.object({
      registered: z.boolean(),
      rateBasisPoints: z.number().int().min(0).max(10_000),
    }).strict(),
    products: z.array(productPriceSchema).min(1),
    peoplePets: z.object({
      fees: z.array(z.object({
        count: z.number().int().min(1).max(5),
        amountInclTaxCents: priceCell,
      }).strict()).length(5),
      additionalEachInclTaxCents: priceCell,
    }).strict(),
    urgentServiceFees: z.array(z.object({
      workingDays: z.number().int().min(1).max(4),
      amountInclTaxCents: priceCell,
    }).strict()).length(4),
    designSurcharges: z.array(z.object({
      key: z.string().trim().min(1).max(120),
      amountInclTaxCents: priceCell,
    }).strict()),
    discounts: z.array(z.object({
      key: z.string().trim().min(1).max(120),
      amountInclTaxCents: priceCell,
    }).strict()),
    shippingMethods: z.array(shippingPriceSchema).min(1),
  }).strict();
}

export const newZealandPriceBookSchema = priceBookSchema("NZ", "NZD");
export const australiaPriceBookSchema = priceBookSchema("AU", "AUD");

export const marketPriceBooksSchema = z.object({
  NZ: newZealandPriceBookSchema,
  AU: australiaPriceBookSchema,
}).strict();

export class MarketPriceBookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketPriceBookValidationError";
  }
}

function addNzGst(amountExGstCents: number): number {
  return Math.round((amountExGstCents * 115) / 100);
}

const BANNER_BUNDLE_AU_SIZE_CENTS: Record<string, number> = {
  "rollup-wall-200x100": 33_999,
  "rollup-wall-300x150": 46_999,
};

function configuredChargeAmount(
  product: LegacyRegistryShape["products"][number],
  field: "extraPhotoPriceExGstCents" | "extraBackgroundRemovalFeeInclGstCents",
  market: Market,
): MarketPriceCell {
  const amount = product.configuration[field];
  if (amount === undefined) return null;
  return market === "NZ" && field === "extraPhotoPriceExGstCents"
    ? addNzGst(amount)
    : market === "NZ"
      ? amount
      : null;
}

function bundleProductPrices(
  registry: LegacyRegistryShape,
  market: Market,
): MarketProductPrice {
  const bundle = registry.products.find((product) => product.key === "banner-bundle");
  const rollUp = registry.products.find((product) => product.key === "roll-up-banner");
  const wallBanner = registry.products.find(
    (product) => product.key === "custom-themed-wall-banner",
  );
  if (!bundle || !rollUp || !wallBanner) {
    throw new MarketPriceBookValidationError("Banner Bundle configuration is incomplete.");
  }
  if (bundle.configuration.sizes.some(
    (size) => size.nzAmountInclTaxCents === undefined,
  )) {
    throw new MarketPriceBookValidationError(
      "Every Banner Bundle size requires an exact NZ GST-inclusive price.",
    );
  }
  return {
    productKey: bundle.key,
    sizes: bundle.configuration.sizes.map((size) => ({
      sizeKey: size.key,
      amountInclTaxCents: market === "NZ"
        ? size.nzAmountInclTaxCents as number
        : BANNER_BUNDLE_AU_SIZE_CENTS[size.key] ?? null,
    })),
    charges: [
      {
        key: "roll-up-extra-photo",
        amountInclTaxCents: configuredChargeAmount(
          rollUp,
          "extraPhotoPriceExGstCents",
          market,
        ),
      },
      {
        key: "roll-up-background-removal",
        amountInclTaxCents: configuredChargeAmount(
          rollUp,
          "extraBackgroundRemovalFeeInclGstCents",
          market,
        ),
      },
      {
        key: "wall-banner-extra-photo",
        amountInclTaxCents: configuredChargeAmount(
          wallBanner,
          "extraPhotoPriceExGstCents",
          market,
        ),
      },
      {
        key: "wall-banner-background-removal",
        amountInclTaxCents: configuredChargeAmount(
          wallBanner,
          "extraBackgroundRemovalFeeInclGstCents",
          market,
        ),
      },
    ],
  };
}

function productPrices(
  registry: LegacyRegistryShape,
  market: Market,
): MarketProductPrice[] {
  return registry.products.map((product) => {
    if (product.key === "banner-bundle") return bundleProductPrices(registry, market);
    return {
      productKey: product.key,
      sizes: product.configuration.sizes.map((size) => ({
        sizeKey: size.key,
        amountInclTaxCents: market === "NZ"
          ? size.nzAmountInclTaxCents ?? addNzGst(size.priceExGstCents)
          : null,
      })),
      charges: [
        ...(product.configuration.extraPhotoPriceExGstCents === undefined
          ? []
          : [{
              key: "extra-photo" as const,
              amountInclTaxCents: market === "NZ"
                ? addNzGst(product.configuration.extraPhotoPriceExGstCents)
                : null,
            }]),
        ...(product.configuration.extraBackgroundRemovalFeeInclGstCents === undefined
          ? []
          : [{
              key: "background-removal" as const,
              amountInclTaxCents: market === "NZ"
                ? product.configuration.extraBackgroundRemovalFeeInclGstCents
                : null,
            }]),
      ],
    };
  });
}

function peoplePetsPrices(registry: LegacyRegistryShape, market: Market) {
  return {
    fees: registry.pricing.peoplePetsFeesExGstCents.map((amount, index) => ({
      count: index + 1,
      amountInclTaxCents: market === "NZ" ? addNzGst(amount) : null,
    })),
    additionalEachInclTaxCents: market === "NZ"
      ? addNzGst(registry.pricing.additionalPeoplePetsEachExGstCents)
      : null,
  };
}

function urgentPrices(registry: LegacyRegistryShape, market: Market) {
  return registry.pricing.urgentServiceFeesInclGstCents.map((amount, index) => ({
    workingDays: index + 1,
    amountInclTaxCents: market === "NZ" ? amount : null,
  }));
}

export function createDefaultMarketPriceBooks(
  registry: LegacyRegistryShape,
): MarketPriceBooks {
  return {
    NZ: {
      market: "NZ",
      currency: "NZD",
      enabled: true,
      tax: { registered: true, rateBasisPoints: 1_500 },
      products: productPrices(registry, "NZ"),
      peoplePets: peoplePetsPrices(registry, "NZ"),
      urgentServiceFees: urgentPrices(registry, "NZ"),
      designSurcharges: [],
      discounts: [],
      shippingMethods: [
        {
          key: "pickup",
          label: "Pickup",
          method: "pickup",
          source: "fixed",
          active: true,
          amountInclTaxCents: 0,
        },
        {
          key: "live-carrier",
          label: "Live carrier rate",
          method: "post",
          source: "carrier",
          active: true,
          amountInclTaxCents: null,
        },
      ],
    },
    AU: {
      market: "AU",
      currency: "AUD",
      enabled: false,
      tax: { registered: false, rateBasisPoints: 1_000 },
      products: productPrices(registry, "AU"),
      peoplePets: peoplePetsPrices(registry, "AU"),
      urgentServiceFees: urgentPrices(registry, "AU"),
      designSurcharges: [],
      discounts: [],
      shippingMethods: structuredClone(AUSTRALIA_FIXED_SHIPPING_METHODS),
    },
  };
}

function sameValues(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function expectedChargeKeys(product: LegacyRegistryShape["products"][number]) {
  if (product.key === "banner-bundle") {
    return [
      "roll-up-extra-photo",
      "roll-up-background-removal",
      "wall-banner-extra-photo",
      "wall-banner-background-removal",
    ];
  }
  return [
    ...(product.configuration.extraPhotoPriceExGstCents === undefined ? [] : ["extra-photo"]),
    ...(product.configuration.extraBackgroundRemovalFeeInclGstCents === undefined
      ? []
      : ["background-removal"]),
  ];
}

function assertUniqueKeys(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new MarketPriceBookValidationError(`${label} keys must be unique.`);
  }
}

export function assertMarketPriceBookStructure(registry: RegistryWithMarkets): void {
  const expectedNz = createDefaultMarketPriceBooks(registry).NZ;
  for (const market of ["NZ", "AU"] as const) {
    const book = registry.markets[market];
    if (!sameValues(
      book.products.map((product) => product.productKey),
      registry.products.map((product) => product.key),
    )) {
      throw new MarketPriceBookValidationError("Market product price structure cannot be changed.");
    }
    for (const [index, productPricesForMarket] of book.products.entries()) {
      const product = registry.products[index];
      if (!sameValues(
        productPricesForMarket.sizes.map((size) => size.sizeKey),
        product.configuration.sizes.map((size) => size.key),
      )) {
        throw new MarketPriceBookValidationError("Market size price structure cannot be changed.");
      }
      if (!sameValues(
        productPricesForMarket.charges.map((charge) => charge.key),
        expectedChargeKeys(product),
      )) {
        throw new MarketPriceBookValidationError("Market charge structure cannot be changed.");
      }
    }
    if (!sameValues(book.peoplePets.fees.map((fee) => fee.count), [1, 2, 3, 4, 5])) {
      throw new MarketPriceBookValidationError("People and pet price structure cannot be changed.");
    }
    if (!sameValues(
      book.urgentServiceFees.map((fee) => fee.workingDays),
      [1, 2, 3, 4],
    )) {
      throw new MarketPriceBookValidationError("Urgent price structure cannot be changed.");
    }
    assertUniqueKeys(book.shippingMethods.map((method) => method.key), "Shipping method");
    if (!book.shippingMethods.some((method) => method.active)) {
      throw new MarketPriceBookValidationError("At least one shipping method must be active.");
    }
    if (market === "AU" && JSON.stringify(book.shippingMethods) !==
      JSON.stringify(AUSTRALIA_FIXED_SHIPPING_METHODS)) {
      throw new MarketPriceBookValidationError(
        "Australia shipping must use the fixed Standard and DHL methods.",
      );
    }
    if (book.designSurcharges.length > 0 || book.discounts.length > 0) {
      throw new MarketPriceBookValidationError("Unconfigured charges cannot be introduced.");
    }
  }

  if (JSON.stringify(registry.markets.NZ.products) !== JSON.stringify(expectedNz.products) ||
      JSON.stringify(registry.markets.NZ.peoplePets) !== JSON.stringify(expectedNz.peoplePets) ||
      JSON.stringify(registry.markets.NZ.urgentServiceFees) !== JSON.stringify(expectedNz.urgentServiceFees)) {
    throw new MarketPriceBookValidationError("New Zealand price mirrors are inconsistent.");
  }
}

export function synchronizeNewZealandPriceBook(registry: RegistryWithMarkets): void {
  const prices = createDefaultMarketPriceBooks(registry).NZ;
  registry.markets.NZ.products = prices.products;
  registry.markets.NZ.peoplePets = prices.peoplePets;
  registry.markets.NZ.urgentServiceFees = prices.urgentServiceFees;
}

export function getMarketCompleteness(
  registry: Pick<RegistryWithMarkets, "markets">,
  market: Market,
): Readonly<{ ready: boolean; missingKeys: readonly string[] }> {
  const book = registry.markets[market];
  const missingKeys: string[] = [];
  for (const product of book.products) {
    for (const size of product.sizes) {
      if (size.amountInclTaxCents === null) {
        missingKeys.push(`products.${product.productKey}.sizes.${size.sizeKey}`);
      }
    }
    for (const charge of product.charges) {
      if (charge.amountInclTaxCents === null) {
        missingKeys.push(`products.${product.productKey}.charges.${charge.key}`);
      }
    }
  }
  for (const fee of book.peoplePets.fees) {
    if (fee.amountInclTaxCents === null) {
      missingKeys.push(`peoplePets.${fee.count}`);
    }
  }
  if (book.peoplePets.additionalEachInclTaxCents === null) {
    missingKeys.push("peoplePets.additionalEach");
  }
  for (const fee of book.urgentServiceFees) {
    if (fee.amountInclTaxCents === null) {
      missingKeys.push(`urgentService.${fee.workingDays}`);
    }
  }
  for (const surcharge of book.designSurcharges) {
    if (surcharge.amountInclTaxCents === null) {
      missingKeys.push(`designSurcharges.${surcharge.key}`);
    }
  }
  for (const discount of book.discounts) {
    if (discount.amountInclTaxCents === null) {
      missingKeys.push(`discounts.${discount.key}`);
    }
  }
  for (const shipping of book.shippingMethods) {
    const fixedAustraliaTable = market === "AU" &&
      AUSTRALIA_FIXED_SHIPPING_METHODS.some((method) => method.key === shipping.key);
    if (
      shipping.active &&
      shipping.source === "fixed" &&
      shipping.amountInclTaxCents === null &&
      !fixedAustraliaTable
    ) {
      missingKeys.push(`shippingMethods.${shipping.key}`);
    }
  }
  return Object.freeze({
    ready: missingKeys.length === 0,
    missingKeys: Object.freeze(missingKeys),
  });
}

export function assertMarketCheckoutReady(
  registry: RegistryWithMarkets,
  market: Market,
): void {
  const book = registry.markets[market];
  if (!book.enabled) {
    throw new MarketPriceBookValidationError(
      market === "AU" ? "Australia market is disabled." : "New Zealand market is disabled.",
    );
  }
  if (!getMarketCompleteness(registry, market).ready) {
    throw new MarketPriceBookValidationError(
      market === "AU"
        ? "Australia price book is incomplete."
        : "New Zealand price book is incomplete.",
    );
  }
}
