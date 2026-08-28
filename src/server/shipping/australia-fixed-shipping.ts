import { createHash } from "node:crypto";
import type { MarketPriceBook } from "@/domain/catalogue/market-price-book";
import type { RepricedCheckoutCart } from "@/domain/checkout/types";
import { includedTaxFromGross, marketTaxPolicy } from "@/domain/markets/market";
import type { ShippingOption } from "./shipping-service";
import type { ProviderShippingQuote, ShippingDestination } from "./types";

export type AustraliaShippingServiceCode = "au-standard" | "au-dhl-express";

type RatePair = Readonly<{ standard: number; dhlExpress: number }>;

export const AUSTRALIA_FIXED_SHIPPING_RATES = Object.freeze({
  canvas: Object.freeze({
    a4: Object.freeze({ standard: 4_500, dhlExpress: 6_600 }),
    a3: Object.freeze({ standard: 4_500, dhlExpress: 6_600 }),
    a2: Object.freeze({ standard: 4_500, dhlExpress: 6_600 }),
    a1: Object.freeze({ standard: 5_500, dhlExpress: 7_800 }),
    a0: Object.freeze({ standard: 12_000, dhlExpress: 18_600 }),
  }),
  rollUpBanner: Object.freeze({ standard: 6_500, dhlExpress: 8_200 }),
  wallBanner: Object.freeze({
    "160x80": Object.freeze({ standard: 4_000, dhlExpress: 7_800 }),
    "200x100": Object.freeze({ standard: 4_000, dhlExpress: 7_800 }),
    "300x150": Object.freeze({ standard: 11_000, dhlExpress: 14_800 }),
  }),
} as const);

const CANVAS_PRODUCTS = new Set([
  "photo-print-canvas",
  "digital-oil-painting-canvas",
  "custom-themed-canvas",
]);
const WALL_BANNER_PRODUCTS = new Set([
  "custom-themed-wall-banner",
  "digital-oil-painting-banner",
]);

export function getAustraliaFixedShippingRates(
  productKey: string,
  sizeKey: string,
): RatePair {
  if (CANVAS_PRODUCTS.has(productKey)) {
    const rate = AUSTRALIA_FIXED_SHIPPING_RATES.canvas[
      sizeKey as keyof typeof AUSTRALIA_FIXED_SHIPPING_RATES.canvas
    ];
    if (rate) return rate;
  }
  if (productKey === "roll-up-banner" && sizeKey === "standard") {
    return AUSTRALIA_FIXED_SHIPPING_RATES.rollUpBanner;
  }
  if (WALL_BANNER_PRODUCTS.has(productKey)) {
    const rate = AUSTRALIA_FIXED_SHIPPING_RATES.wallBanner[
      sizeKey as keyof typeof AUSTRALIA_FIXED_SHIPPING_RATES.wallBanner
    ];
    if (rate) return rate;
  }
  if (productKey === "grave-cover" && sizeKey === "standard") {
    return AUSTRALIA_FIXED_SHIPPING_RATES.wallBanner["200x100"];
  }
  if (productKey === "banner-bundle") {
    if (sizeKey === "rollup-wall-200x100") {
      return Object.freeze({
        standard: AUSTRALIA_FIXED_SHIPPING_RATES.rollUpBanner.standard
          + AUSTRALIA_FIXED_SHIPPING_RATES.wallBanner["200x100"].standard,
        dhlExpress: AUSTRALIA_FIXED_SHIPPING_RATES.rollUpBanner.dhlExpress
          + AUSTRALIA_FIXED_SHIPPING_RATES.wallBanner["200x100"].dhlExpress,
      });
    }
    if (sizeKey === "rollup-wall-300x150") {
      return Object.freeze({
        standard: AUSTRALIA_FIXED_SHIPPING_RATES.rollUpBanner.standard
          + AUSTRALIA_FIXED_SHIPPING_RATES.wallBanner["300x150"].standard,
        dhlExpress: AUSTRALIA_FIXED_SHIPPING_RATES.rollUpBanner.dhlExpress
          + AUSTRALIA_FIXED_SHIPPING_RATES.wallBanner["300x150"].dhlExpress,
      });
    }
  }
  throw new Error(`No confirmed fixed Australia shipping rate exists for ${productKey}:${sizeKey}.`);
}

function amountFor(
  cart: RepricedCheckoutCart,
  serviceCode: AustraliaShippingServiceCode,
): number {
  return cart.items.reduce((total, item) => {
    const rate = getAustraliaFixedShippingRates(item.productKey, item.sizeKey);
    const unitAmount = serviceCode === "au-standard" ? rate.standard : rate.dhlExpress;
    return total + unitAmount * item.quantity;
  }, 0);
}

function fixedQuote(
  cart: RepricedCheckoutCart,
  destination: ShippingDestination,
  priceBook: MarketPriceBook | undefined,
  serviceCode: AustraliaShippingServiceCode,
  now: Date,
): Readonly<{ quote: ProviderShippingQuote; option: ShippingOption; requestDigest: string }> {
  const serviceName = serviceCode === "au-standard" ? "Standard Shipping" : "DHL Express";
  const amountInclGstCents = amountFor(cart, serviceCode);
  const tax = includedTaxFromGross(
    amountInclGstCents,
    marketTaxPolicy("AU", priceBook?.tax),
  );
  const digest = createHash("sha256")
    .update(JSON.stringify({
      cartDigest: cart.cartDigest,
      destination,
      serviceCode,
      amountInclGstCents,
    }))
    .digest("hex");
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1_000);
  const quote = Object.freeze({
    provider: "internal-fixed" as const,
    serviceCode,
    serviceName,
    amountExGstCents: tax.amountExTaxCents,
    gstCents: tax.taxCents,
    amountInclGstCents: tax.amountInclTaxCents,
    currency: "AUD" as const,
    providerReference: `au-fixed:${serviceCode}:${digest}`,
    expiresAt,
    rawResponseHash: digest,
    isTest: false,
  });
  return Object.freeze({
    requestDigest: digest,
    quote,
    option: Object.freeze({
      method: "post" as const,
      serviceCode,
      serviceName,
      amountExGstCents: quote.amountExGstCents,
      gstCents: quote.gstCents,
      amountInclGstCents: quote.amountInclGstCents,
      currency: quote.currency,
      provenance: quote.provider,
      isTest: false,
      expiresAt,
    }),
  });
}

export function quoteAustraliaFixedShipping(
  cart: RepricedCheckoutCart,
  destination: ShippingDestination,
  priceBook: MarketPriceBook | undefined,
  requestedServiceCode: string | undefined,
  now: Date,
) {
  const quotes = [
    fixedQuote(cart, destination, priceBook, "au-standard", now),
    fixedQuote(cart, destination, priceBook, "au-dhl-express", now),
  ] as const;
  const selectedServiceCode = requestedServiceCode ?? "au-standard";
  const selected = quotes.find(({ quote }) => quote.serviceCode === selectedServiceCode);
  if (!selected) {
    throw new Error("The selected Australia shipping method is unavailable.");
  }
  return Object.freeze({
    ...selected,
    options: Object.freeze(quotes.map(({ option }) => option)),
  });
}
