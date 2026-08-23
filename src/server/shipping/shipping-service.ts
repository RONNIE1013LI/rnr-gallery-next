import { createHash } from "node:crypto";
import type { NormalizedAddress } from "@/domain/address/types";
import type { MarketPriceBook } from "@/domain/catalogue/market-price-book";
import type { RepricedCheckoutCart } from "@/domain/checkout/types";
import { marketTaxPolicy } from "@/domain/markets/market";
import type { MarketCurrency } from "@/domain/markets/types";
import { createGoSweetSpotShippingProvider } from "./gosweetspot-provider";
import { createLocalTestShippingProvider } from "./local-test-provider";
import { getPackageProfiles } from "./package-registry";
import type {
  PackageProfile,
  ProviderShippingQuote,
  ShippingPackage,
  ShippingDestination,
  ShippingQuoteProvider,
  ShippingQuoteRequest,
} from "./types";
import { quoteAustraliaFixedShipping } from "./australia-fixed-shipping";

type ShippingEnvironment = Readonly<Record<string, string | undefined>>;

export type ShippingOption = Readonly<{
  method: "pickup" | "post";
  serviceCode: string;
  serviceName: string;
  amountExGstCents: number;
  gstCents: number;
  amountInclGstCents: number;
  currency: MarketCurrency;
  provenance: "internal" | ProviderShippingQuote["provider"];
  isTest: boolean;
  expiresAt?: Date;
}>;

export class ShippingUnavailableError extends Error {
  constructor(message = "Post shipping is currently unavailable", options?: ErrorOptions) {
    super(message, options);
    this.name = "ShippingUnavailableError";
  }
}

function packagesFor(cart: RepricedCheckoutCart): ShippingPackage[] {
  return cart.items.flatMap((item) => {
    const profiles = getPackageProfiles(item.productKey, item.sizeKey);
    const totalWeightGrams = profiles.reduce(
      (total, profile) => total + profile.weightGrams,
      0,
    );
    const unitTotal = item.unitPrice.totalInclGstCents;
    const allocated = profiles.map((profile) => Number(
      (BigInt(unitTotal) * BigInt(profile.weightGrams)) / BigInt(totalWeightGrams),
    ));
    allocated[0] += unitTotal - allocated.reduce((sum, value) => sum + value, 0);
    if (allocated.reduce((sum, value) => sum + value, 0) !== unitTotal) {
      throw new Error("Shipping package values must equal the authoritative item unit total.");
    }

    return Array.from({ length: item.quantity }, () =>
      profiles.map((profile, index) => Object.freeze({
        ...profile,
        unitPriceInclGstCents: allocated[index],
      })),
    ).flat();
  });
}

function destinationFor(address: NormalizedAddress): ShippingDestination {
  return Object.freeze({
    contact: address.fullName,
    street: [address.building, address.street].filter(Boolean).join(", "),
    suburb: address.suburb,
    // GoSweetSpot names this field `city`, but documents it as city/state and
    // requires official state abbreviations for countries such as AU (for example NSW).
    city: address.region,
    postcode: address.postcode,
    countryCode: address.country,
  });
}

function requestDigest(
  cart: RepricedCheckoutCart,
  destination: ShippingDestination,
  packages: readonly PackageProfile[],
): string {
  return createHash("sha256")
    .update(JSON.stringify({ cartDigest: cart.cartDigest, destination, packages }))
    .digest("hex");
}

function assertCurrentPositiveQuote(
  quote: ProviderShippingQuote,
  now: Date,
  expectedCurrency: MarketCurrency,
) {
  const amounts = [
    quote.amountExGstCents,
    quote.gstCents,
    quote.amountInclGstCents,
  ];
  const expiry = quote.expiresAt.getTime();
  if (
    amounts.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    quote.amountInclGstCents <= 0 ||
    quote.amountExGstCents + quote.gstCents !== quote.amountInclGstCents ||
    quote.currency !== expectedCurrency ||
    !Number.isFinite(expiry) ||
    expiry <= now.getTime()
  ) {
    throw new ShippingUnavailableError("The shipping provider returned no current positive rate");
  }
}

export function createShippingService({
  provider,
  now = () => new Date(),
}: {
  provider: ShippingQuoteProvider | null;
  now?: () => Date;
}) {
  return {
    async pickup(): Promise<ShippingOption> {
      return Object.freeze({
        method: "pickup" as const,
        serviceCode: "pickup",
        serviceName: "Pickup",
        amountExGstCents: 0,
        gstCents: 0,
        amountInclGstCents: 0,
        currency: "NZD" as const,
        provenance: "internal" as const,
        isTest: false,
      });
    },

    async quotePost(
      cart: RepricedCheckoutCart,
      address: NormalizedAddress,
      priceBook?: MarketPriceBook,
      requestedServiceCode?: string,
    ) {
      if (cart.market !== address.country) {
        throw new ShippingUnavailableError("The shipping destination does not match the cart market");
      }
      const destination = destinationFor(address);
      if (cart.market === "AU") {
        try {
          return quoteAustraliaFixedShipping(
            cart,
            destination,
            priceBook,
            requestedServiceCode,
            now(),
          );
        } catch (error) {
          throw new ShippingUnavailableError(
            error instanceof Error ? error.message : "Australia shipping is unavailable",
            { cause: error },
          );
        }
      }
      const packages = packagesFor(cart);
      const digest = requestDigest(cart, destination, packages);
      if (!provider) throw new ShippingUnavailableError();
      try {
        const availability = await provider.availability();
        if (!availability.available) {
          throw new ShippingUnavailableError(availability.reason);
        }

        const request: ShippingQuoteRequest = Object.freeze({
          market: cart.market,
          currency: cart.currency,
          taxPolicy: marketTaxPolicy(cart.market, priceBook?.tax),
          cartValueInclGstCents: cart.totalInclGstCents,
          packages: Object.freeze(packages),
          destination,
        });
        const quote = await provider.quote(request);
        assertCurrentPositiveQuote(quote, now(), cart.currency);
        if (requestedServiceCode && requestedServiceCode !== quote.serviceCode) {
          throw new ShippingUnavailableError("The selected shipping method is unavailable");
        }
        const option = Object.freeze({
          method: "post" as const,
          serviceCode: quote.serviceCode,
          serviceName: quote.serviceName,
          amountExGstCents: quote.amountExGstCents,
          gstCents: quote.gstCents,
          amountInclGstCents: quote.amountInclGstCents,
          currency: quote.currency,
          provenance: quote.provider,
          isTest: quote.isTest,
          expiresAt: quote.expiresAt,
        });
        return Object.freeze({
          requestDigest: digest,
          quote,
          option,
          options: Object.freeze([option]),
        });
      } catch (error) {
        if (error instanceof ShippingUnavailableError) throw error;
        throw new ShippingUnavailableError("Post shipping quote failed", {
          cause: error,
        });
      }
    },
  };
}

export function selectShippingProvider(
  env: ShippingEnvironment = process.env,
): ShippingQuoteProvider | null {
  const appId = env.GOSWEETSPOT_APP_ID?.trim();
  const secret = env.GOSWEETSPOT_HMAC_SECRET?.trim();
  const rateTaxMode = env.GOSWEETSPOT_RATE_TAX_MODE?.trim();
  if (
    appId &&
    secret &&
    (rateTaxMode === "incl_gst" || rateTaxMode === "ex_gst")
  ) {
    const timeout = Number(env.GOSWEETSPOT_TIMEOUT_MS ?? 5_000);
    return createGoSweetSpotShippingProvider({
      appId,
      secret,
      rateTaxMode,
      timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 5_000,
    });
  }

  if (
    env.ENABLE_LOCAL_TEST_SHIPPING === "true" &&
    env.NODE_ENV !== "production" &&
    process.env.NODE_ENV !== "production"
  ) {
    return createLocalTestShippingProvider();
  }
  return null;
}
