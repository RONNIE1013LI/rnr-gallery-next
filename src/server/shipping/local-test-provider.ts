import { createHash } from "node:crypto";
import { includedTaxFromGross } from "@/domain/markets/market";
import type { ShippingQuoteProvider, ShippingQuoteRequest } from "./types";

type LocalTestProviderOptions = Readonly<{
  now?: () => Date;
}>;

function createQuote(request: ShippingQuoteRequest, now: Date) {
  const isNewZealand = request.destination.countryCode === "NZ";
  const amountInclGstCents = isNewZealand ? 2_300 : 4_500;
  const tax = includedTaxFromGross(amountInclGstCents, request.taxPolicy);
  const rawResponseHash = createHash("sha256")
    .update(JSON.stringify({ country: request.destination.countryCode, amountInclGstCents }))
    .digest("hex");

  return Object.freeze({
    provider: "local-test" as const,
    serviceCode: isNewZealand ? "test-post-nz" : "test-post-au",
    serviceName: "Test Post — not a live carrier rate",
    amountExGstCents: tax.amountExTaxCents,
    gstCents: tax.taxCents,
    amountInclGstCents: tax.amountInclTaxCents,
    currency: request.currency,
    providerReference: `local-test:${rawResponseHash.slice(0, 16)}`,
    expiresAt: new Date(now.getTime() + 15 * 60 * 1_000),
    rawResponseHash,
    isTest: true,
  });
}

export function createLocalTestShippingProvider(
  options: LocalTestProviderOptions = {},
): ShippingQuoteProvider {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The local test shipping provider cannot run in production.");
  }
  const now = options.now ?? (() => new Date());

  return Object.freeze({
    key: "local-test" as const,
    async availability() {
      return Object.freeze({ available: true });
    },
    async quote(request: ShippingQuoteRequest) {
      return createQuote(request, now());
    },
  });
}
