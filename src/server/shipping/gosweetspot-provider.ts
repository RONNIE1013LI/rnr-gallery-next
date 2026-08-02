import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import {
  ShippingProviderError,
  type ProviderAvailability,
  type ShippingQuoteProvider,
  type ShippingQuoteRequest,
} from "./types";

const responseSchema = z.array(z.object({
  description: z.string().trim().min(1),
  shortcode: z.string().trim().min(1),
  rate: z.number().finite(),
}));

type RateTaxMode = "incl_gst" | "ex_gst";

type GoSweetSpotOptions = Readonly<{
  appId?: string;
  secret?: string;
  rateTaxMode?: RateTaxMode;
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

function taxAmounts(rate: number, mode: RateTaxMode) {
  if (mode === "incl_gst") {
    const amountInclGstCents = safeCents(rate);
    const amountExGstCents = Math.round((amountInclGstCents * 100) / 115);
    return {
      amountExGstCents,
      gstCents: amountInclGstCents - amountExGstCents,
      amountInclGstCents,
    };
  }

  const amountExGstCents = safeCents(rate);
  const gstCents = Math.round((amountExGstCents * 15) / 100);
  return { amountExGstCents, gstCents, amountInclGstCents: amountExGstCents + gstCents };
}

export function createGoSweetSpotShippingProvider(
  options: GoSweetSpotOptions,
): ShippingQuoteProvider {
  const availability = availabilityFor(options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? 5_000;

  return Object.freeze({
    key: "gosweetspot" as const,
    async availability() {
      return Object.freeze({ ...availability });
    },
    async quote(request: ShippingQuoteRequest) {
      if (!availability.available || !options.appId || !options.secret || !options.rateTaxMode) {
        throw new ShippingProviderError("GoSweetSpot shipping is unavailable.");
      }
      if (!Number.isSafeInteger(request.cartValueInclGstCents) || request.cartValueInclGstCents < 0) {
        throw new ShippingProviderError("The authoritative cart value is invalid.");
      }
      if (request.packages.length < 1) {
        throw new ShippingProviderError("At least one shipping package is required.");
      }
      const weightGrams = request.packages.reduce((total, item) => total + item.weightGrams, 0);
      if (!Number.isSafeInteger(weightGrams) || weightGrams <= 0) {
        throw new ShippingProviderError("The package weight is invalid.");
      }

      const rawBody = JSON.stringify({
        weight: weightGrams / 1_000,
        cartvalue: request.cartValueInclGstCents / 100,
        destination: {
          Contact: request.destination.contact,
          street: request.destination.street,
          suburb: request.destination.suburb,
          city: request.destination.city,
          postcode: request.destination.postcode,
          countrycode: request.destination.countryCode,
        },
      });
      const signature = createHmac("sha256", options.secret)
        .update(rawBody)
        .digest("hex");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(
          `https://checkout.gosweetspot.com/CustomApi/Rates/${encodeURIComponent(options.appId)}`,
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
        const amounts = taxAmounts(selected.rate, options.rateTaxMode);
        const rawResponseHash = createHash("sha256").update(rawResponse).digest("hex");

        return Object.freeze({
          provider: "gosweetspot" as const,
          serviceCode: selected.shortcode,
          serviceName: selected.description,
          ...amounts,
          currency: "NZD" as const,
          providerReference: `${selected.shortcode}:${rawResponseHash.slice(0, 16)}`,
          expiresAt: new Date(now().getTime() + 15 * 60 * 1_000),
          rawResponseHash,
          isTest: false,
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
