import { createHash } from "node:crypto";
import type { ShippingQuoteProvider, ShippingQuoteRequest } from "./types";

type LocalTestProviderOptions = Readonly<{
  nodeEnv?: string;
  now?: () => Date;
}>;

function createQuote(request: ShippingQuoteRequest, now: Date) {
  const isNewZealand = request.destination.countryCode === "NZ";
  const amountExGstCents = isNewZealand ? 2_000 : 4_500;
  const gstCents = isNewZealand ? 300 : 0;
  const amountInclGstCents = amountExGstCents + gstCents;
  const rawResponseHash = createHash("sha256")
    .update(JSON.stringify({ country: request.destination.countryCode, amountInclGstCents }))
    .digest("hex");

  return Object.freeze({
    provider: "local-test" as const,
    serviceCode: isNewZealand ? "test-post-nz" : "test-post-au",
    serviceName: "Test Post — not a live carrier rate",
    amountExGstCents,
    gstCents,
    amountInclGstCents,
    currency: "NZD" as const,
    providerReference: `local-test:${rawResponseHash.slice(0, 16)}`,
    expiresAt: new Date(now.getTime() + 15 * 60 * 1_000),
    rawResponseHash,
    isTest: true,
  });
}

export function createLocalTestShippingProvider(
  options: LocalTestProviderOptions = {},
): ShippingQuoteProvider {
  if ((options.nodeEnv ?? process.env.NODE_ENV) === "production") {
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
