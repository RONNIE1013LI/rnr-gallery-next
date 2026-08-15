import {
  assertMarketCheckoutReady,
  type MarketPriceCell,
} from "@/domain/catalogue/market-price-book";
import {
  schemaFromRegistry,
  type ProductRegistryDocument,
} from "@/domain/catalogue/product-registry";
import {
  includedTaxFromGross,
  marketTaxPolicy,
} from "@/domain/markets/market";
import type { Market } from "@/domain/markets/types";
import {
  InvalidPricingInputError,
  type MarketPriceBreakdown,
  type PriceLine,
} from "./types";

type MarketQuoteSelection = Readonly<{
  sizeKey: string;
  peoplePets: number;
  urgentWorkingDays?: number;
  sourcePhotoCount?: number;
  extraBackgroundRemovalCount?: number;
}>;

function requiredPrice(value: MarketPriceCell | undefined, label: string): number {
  if (value === null || value === undefined) {
    throw new InvalidPricingInputError(`${label} is not configured for this market.`);
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidPricingInputError(`${label} must contain non-negative safe integer cents.`);
  }
  return value;
}

function peoplePetsGross(
  book: ProductRegistryDocument["markets"]["NZ"] | ProductRegistryDocument["markets"]["AU"],
  count: number,
): number {
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new InvalidPricingInputError("People / pets must be between 1 and 20.");
  }
  if (count <= 5) {
    return requiredPrice(
      book.peoplePets.fees.find((fee) => fee.count === count)?.amountInclTaxCents,
      "People / pets price",
    );
  }
  const five = requiredPrice(
    book.peoplePets.fees.find((fee) => fee.count === 5)?.amountInclTaxCents,
    "Five people / pets price",
  );
  return five + (count - 5) * requiredPrice(
    book.peoplePets.additionalEachInclTaxCents,
    "Additional people / pets price",
  );
}

export function quoteMarketConfiguration(
  registry: ProductRegistryDocument,
  market: Market,
  productKey: string,
  selection: MarketQuoteSelection,
): MarketPriceBreakdown {
  assertMarketCheckoutReady(registry, market);
  const book = registry.markets[market];
  const productPrices = book.products.find((product) => product.productKey === productKey);
  const schema = schemaFromRegistry(registry, productKey);
  if (!productPrices || !schema) {
    throw new InvalidPricingInputError("The product is unavailable for this market.");
  }
  const size = productPrices.sizes.find((entry) => entry.sizeKey === selection.sizeKey);
  if (!size) {
    throw new InvalidPricingInputError(`Size ${selection.sizeKey} is unavailable for ${productKey}.`);
  }

  const grossLines: Array<Readonly<{
    key: string;
    label: string;
    amountInclTaxCents: number;
    preserveGross: boolean;
  }>> = [{
    key: "product-size",
    label: "Product / size price",
    amountInclTaxCents: requiredPrice(size.amountInclTaxCents, "Product / size price"),
    preserveGross: market === "AU",
  }];

  if (schema.peoplePetsMode === "required") {
    grossLines.push({
      key: "people-pets",
      label: "People / pets fee",
      amountInclTaxCents: peoplePetsGross(book, selection.peoplePets),
      preserveGross: market === "AU",
    });
  } else if (selection.peoplePets !== 0) {
    throw new InvalidPricingInputError(
      `People / pets pricing is unavailable for ${productKey}.`,
    );
  }

  const extraPhotoCount = Math.max(
    0,
    (selection.sourcePhotoCount ?? 0) - schema.includedPhotos,
  );
  if (extraPhotoCount > 0) {
    const each = productPrices.charges.find((charge) => charge.key === "extra-photo");
    if (each) {
      grossLines.push({
        key: "extra-photos",
        label: "Extra photos",
        amountInclTaxCents: extraPhotoCount * requiredPrice(
          each.amountInclTaxCents,
          "Extra photo price",
        ),
        preserveGross: market === "AU",
      });
    }
  }

  const backgroundCount = selection.extraBackgroundRemovalCount ?? 0;
  if (backgroundCount > 0) {
    const each = productPrices.charges.find((charge) => charge.key === "background-removal");
    if (each) {
      grossLines.push({
        key: "extra-background-removals",
        label: "Extra background removals",
        amountInclTaxCents: backgroundCount * requiredPrice(
          each.amountInclTaxCents,
          "Background removal price",
        ),
        preserveGross: true,
      });
    }
  }

  if (selection.urgentWorkingDays !== undefined) {
    const urgent = book.urgentServiceFees.find(
      (fee) => fee.workingDays === selection.urgentWorkingDays,
    );
    grossLines.push({
      key: "urgent-service",
      label: "Urgent service",
      amountInclTaxCents: requiredPrice(urgent?.amountInclTaxCents, "Urgent service price"),
      preserveGross: true,
    });
  }

  const policy = marketTaxPolicy(market, book.tax);
  const converted = grossLines.map((line) => {
    const amount = includedTaxFromGross(line.amountInclTaxCents, policy);
    const priceLine: PriceLine = Object.freeze({
      key: line.key,
      label: line.label,
      amountExGstCents: amount.amountExTaxCents,
      ...(line.preserveGross ? { amountInclGstCents: amount.amountInclTaxCents } : {}),
    });
    return { amount, priceLine };
  });
  const subtotalExGstCents = converted.reduce(
    (total, line) => total + line.amount.amountExTaxCents,
    0,
  );
  const gstCents = converted.reduce((total, line) => total + line.amount.taxCents, 0);
  const totalInclGstCents = converted.reduce(
    (total, line) => total + line.amount.amountInclTaxCents,
    0,
  );

  return Object.freeze({
    market,
    currency: book.currency,
    taxJurisdiction: policy.jurisdiction,
    taxRateBasisPoints: policy.rateBasisPoints,
    lines: Object.freeze(converted.map((line) => line.priceLine)),
    subtotalExGstCents,
    gstCents,
    totalInclGstCents,
    discountCents: 0,
    designSurchargeCents: 0,
  });
}

export function getMarketStartingPriceInclTaxCents(
  registry: ProductRegistryDocument,
  market: Market,
  productKey: string,
): number {
  const schema = schemaFromRegistry(registry, productKey);
  if (!schema) {
    throw new InvalidPricingInputError("The product is unavailable for this market.");
  }
  return quoteMarketConfiguration(registry, market, productKey, {
    sizeKey: schema.defaultSizeKey,
    peoplePets: schema.defaultPeoplePets,
  }).totalInclGstCents;
}
