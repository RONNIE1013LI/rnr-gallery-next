import type { NormalizedAddress } from "@/domain/address/types";
import type { RepricedCheckoutCart } from "@/domain/checkout/types";
import type { DeliveryPreference } from "@/domain/configuration/types";
import type { ShippingOption } from "@/server/shipping/shipping-service";
import type { CheckoutStateRecord } from "./checkout-repository";

export type PublicCheckoutDTO = Readonly<{
  version: number;
  cart: RepricedCheckoutCart;
  billingAddress: NormalizedAddress;
  deliveryAddress: NormalizedAddress;
  deliveryMethod: DeliveryPreference;
  hasSelectedShippingQuote: boolean;
}>;

export type PublicShippingDTO = Readonly<{
  option: PublicShippingOptionDTO;
  options: readonly PublicShippingOptionDTO[];
}>;

type PublicShippingOptionDTO = Readonly<{
    method: ShippingOption["method"];
    serviceCode: string;
    serviceName: string;
    amountExGstCents: number;
    gstCents: number;
    amountInclGstCents: number;
    currency: ShippingOption["currency"];
    provenance: ShippingOption["provenance"];
    isTest: boolean;
    expiresAt?: string;
}>;

export function toPublicCheckoutDTO(state: CheckoutStateRecord): PublicCheckoutDTO {
  if (
    !state.cartSnapshot ||
    !state.billingAddress ||
    !state.deliveryAddress ||
    !state.deliveryMethod
  ) {
    throw new TypeError("Cannot expose an incomplete checkout session");
  }
  return Object.freeze({
    version: state.version,
    cart: state.cartSnapshot,
    billingAddress: state.billingAddress,
    deliveryAddress: state.deliveryAddress,
    deliveryMethod: state.deliveryMethod,
    hasSelectedShippingQuote: state.selectedShippingQuoteId !== null,
  });
}

export function toPublicShippingDTO(result: {
  option: ShippingOption;
  options: readonly ShippingOption[];
}): PublicShippingDTO {
  const toOption = (option: ShippingOption): PublicShippingOptionDTO => Object.freeze({
    method: option.method,
    serviceCode: option.serviceCode,
    serviceName: option.serviceName,
    amountExGstCents: option.amountExGstCents,
    gstCents: option.gstCents,
    amountInclGstCents: option.amountInclGstCents,
    currency: option.currency,
    provenance: option.provenance,
    isTest: option.isTest,
    ...(option.expiresAt ? { expiresAt: option.expiresAt.toISOString() } : {}),
  });
  return Object.freeze({
    option: toOption(result.option),
    options: Object.freeze(result.options.map(toOption)),
  });
}
