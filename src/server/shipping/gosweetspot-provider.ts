import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import {
  ShippingProviderError,
  type ProviderAvailability,
  type ShippingQuoteProvider,
  type ShippingQuoteRequest,
} from "./types";
import { currencyForMarket, includedTaxFromGross } from "@/domain/markets/market";
import { normalizeShippingServiceName } from "@/domain/shipping/service-name";

const rateSchema = z.object({
  description: z.string().trim().min(1),
  shortcode: z.string().trim().min(1).nullish(),
  shortCode: z.string().trim().min(1).nullish(),
  rate: z.number().finite(),
}).superRefine((rate, context) => {
  if (rate.shortcode && rate.shortCode && rate.shortcode !== rate.shortCode) {
    context.addIssue({
      code: "custom",
      message: "GoSweetSpot returned conflicting short codes.",
    });
  }
}).transform((rate) => ({
  description: rate.description,
  shortcode: rate.shortcode ?? rate.shortCode ??
    `gss-${createHash("sha256").update(rate.description).digest("hex").slice(0, 12)}`,
  rate: rate.rate,
}));

const rateListSchema = z.array(rateSchema);
const responseSchema = z.union([
  rateListSchema,
  z.object({ rates: rateListSchema }).transform((response) => response.rates),
]);

type RateTaxMode = "incl_gst" | "ex_gst";
type GoSweetSpotEnvironment = "production" | "staging";

type GoSweetSpotOptions = Readonly<{
  appId?: string;
  secret?: string;
  rateTaxMode?: RateTaxMode;
  environment?: GoSweetSpotEnvironment;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}>;

function availabilityFor(options: GoSweetSpotOptions): ProviderAvailability {
  if (!options.appId?.trim()) return { available: false, reason: "GoSweetSpot app ID is missing." };
  if (!options.secret?.trim()) return { available: false, reason: "GoSweetSpot HMAC secret is missing." };
  if (options.rateTaxMode !== "incl_gst" && options.rateTaxMode !== "ex_gst") {
    return { available: false, reason: "GoSweetSpot rate GST mode is missing." };
  }
  return { available: true };
}

function safeCents(value: number): number {
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new ShippingProviderError("GoSweetSpot returned an invalid rate.");
  }
  return cents;
}

function grossCentsForRate(rate: number, mode: RateTaxMode, market: ShippingQuoteRequest["market"]): number {
  const rateCents = safeCents(rate);
  if (market !== "NZ" || mode === "incl_gst") return rateCents;
  return rateCents + Math.round((rateCents * 15) / 100);
}

function normalizeGoSweetSpotText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\p{M}/gu, "")
    .replace(/[^\x20-\x7e]/g, "");
}

export function createGoSweetSpotShippingProvider(
  options: GoSweetSpotOptions,
): ShippingQuoteProvider {
  const availability = availabilityFor(options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? 5_000;
  const environment = options.environment ?? "production";
  const checkoutOrigin = environment === "staging"
    ? "https://stg-checkout.gosweetspot.com"
    : "https://checkout.gosweetspot.com";

  return Object.freeze({
    key: "gosweetspot" as const,
    async availability() {
      return Object.freeze({ ...availability });
    },
    async quote(request: ShippingQuoteRequest) {
      if (!availability.available || !options.appId || !options.secret || !options.rateTaxMode) {
        throw new ShippingProviderError("GoSweetSpot shipping is unavailable.");
      }
      if (
        request.market !== request.destination.countryCode ||
        request.currency !== currencyForMarket(request.market)
      ) {
        throw new ShippingProviderError("The shipping market context is invalid.");
      }
      if (!Number.isSafeInteger(request.cartValueInclGstCents) || request.cartValueInclGstCents < 0) {
        throw new ShippingProviderError("The authoritative cart value is invalid.");
      }
      if (request.packages.length < 1) {
        throw new ShippingProviderError("At least one shipping package is required.");
      }
      if (request.packages.some((item) =>
        !Number.isSafeInteger(item.lengthMm) || item.lengthMm <= 0 ||
        !Number.isSafeInteger(item.widthMm) || item.widthMm <= 0 ||
        !Number.isSafeInteger(item.heightMm) || item.heightMm <= 0 ||
        !Number.isSafeInteger(item.weightGrams) || item.weightGrams <= 0 ||
        !Number.isSafeInteger(item.unitPriceInclGstCents) || item.unitPriceInclGstCents < 0
      )) {
        throw new ShippingProviderError("The package details are invalid.");
      }
      const weightGrams = request.packages.reduce((total, item) => total + item.weightGrams, 0);
      if (!Number.isSafeInteger(weightGrams) || weightGrams <= 0) {
        throw new ShippingProviderError("The package weight is invalid.");
      }

      const rawBody = JSON.stringify({
        weight: weightGrams / 1_000,
        cartvalue: request.cartValueInclGstCents / 100,
        destination: {
          Contact: normalizeGoSweetSpotText(request.destination.contact),
          street: normalizeGoSweetSpotText(request.destination.street),
          suburb: normalizeGoSweetSpotText(request.destination.suburb),
          city: normalizeGoSweetSpotText(request.destination.city),
          Country: request.destination.countryCode,
          Postcode: request.destination.postcode,
        },
        Products: request.packages.map((item) => ({
          Quantity: 1,
          UnitWeightKg: item.weightGrams / 1_000,
          UnitPrice: item.unitPriceInclGstCents / 100,
          UnitLengthCm: item.lengthMm / 10,
          UnitWidthCm: item.widthMm / 10,
          UnitHeightCm: item.heightMm / 10,
        })),
      });
      const signature = createHmac("sha256", options.secret)
        .update(rawBody)
        .digest("hex");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(
          `${checkoutOrigin}/CustomApi/Rates/${encodeURIComponent(options.appId)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-GSS-Hmac-Sha256": signature,
            },
            body: rawBody,
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          throw new ShippingProviderError(`GoSweetSpot returned HTTP ${response.status}.`);
        }
        const rawResponse = await response.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawResponse);
        } catch (error) {
          throw new ShippingProviderError("GoSweetSpot returned malformed JSON.", { cause: error });
        }
        const rates = responseSchema.parse(parsed)
          .filter((candidate) => candidate.rate > 0)
          .sort((left, right) => left.rate - right.rate);
        const selected = rates[0];
        if (!selected) {
          throw new ShippingProviderError("GoSweetSpot returned no positive shipping rate.");
        }
        const grossCents = grossCentsForRate(selected.rate, options.rateTaxMode, request.market);
        const tax = includedTaxFromGross(grossCents, request.taxPolicy);
        const rawResponseHash = createHash("sha256").update(rawResponse).digest("hex");

        return Object.freeze({
          provider: "gosweetspot" as const,
          serviceCode: selected.shortcode,
          serviceName: normalizeShippingServiceName(selected.description),
          amountExGstCents: tax.amountExTaxCents,
          gstCents: tax.taxCents,
          amountInclGstCents: tax.amountInclTaxCents,
          currency: request.currency,
          providerReference: `${selected.shortcode}:${rawResponseHash.slice(0, 16)}`,
          expiresAt: new Date(now().getTime() + 15 * 60 * 1_000),
          rawResponseHash,
          isTest: environment === "staging",
        });
      } catch (error) {
        if (error instanceof ShippingProviderError) throw error;
        throw new ShippingProviderError("GoSweetSpot shipping quote failed.", { cause: error });
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}
