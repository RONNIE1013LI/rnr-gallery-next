import type { DeliveryPreference } from "@/domain/configuration/types";
import type { Market, MarketCurrency, TaxJurisdiction } from "@/domain/markets/types";
import type { MarketPriceBreakdown } from "@/domain/pricing/types";
import type { RepricedCheckoutCart } from "@/domain/checkout/types";
import type { Cart, CartItem, CartTotals } from "./types";

function assertQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new RangeError("Cart quantity must be a positive integer.");
  }
}

export function emptyCart(): Cart {
  return Object.freeze({ version: 1, items: Object.freeze([]) });
}

export function addCartItem(cart: Cart, item: CartItem): Cart {
  assertQuantity(item.quantity);
  const existing = cart.items.find((candidate) => candidate.id === item.id);

  if (!existing) {
    return Object.freeze({
      version: 1,
      items: Object.freeze([...cart.items, Object.freeze({ ...item })]),
    });
  }

  return setCartItemQuantity(
    cart,
    item.id,
    existing.quantity + item.quantity,
  );
}

export function setCartItemQuantity(
  cart: Cart,
  itemId: string,
  quantity: number,
): Cart {
  assertQuantity(quantity);
  return Object.freeze({
    version: 1,
    items: Object.freeze(
      cart.items.map((item) =>
        item.id === itemId ? Object.freeze({ ...item, quantity }) : item,
      ),
    ),
  });
}

export function removeCartItem(cart: Cart, itemId: string): Cart {
  return Object.freeze({
    version: 1,
    items: Object.freeze(cart.items.filter((item) => item.id !== itemId)),
  });
}

export function setCartDeliveryPreference(
  cart: Cart,
  deliveryPreference: DeliveryPreference,
): Cart {
  return Object.freeze({
    version: 1,
    items: Object.freeze(
      cart.items.map((item) =>
        item.deliveryPreference === deliveryPreference
          ? item
          : Object.freeze({ ...item, deliveryPreference }),
      ),
    ),
  });
}

export function calculateCartTotals(cart: Cart): CartTotals {
  return cart.items.reduce<CartTotals>(
    (totals, item) => ({
      subtotalExGstCents:
        totals.subtotalExGstCents +
        item.price.subtotalExGstCents * item.quantity,
      gstCents: totals.gstCents + item.price.gstCents * item.quantity,
      totalInclGstCents:
        totals.totalInclGstCents +
        item.price.totalInclGstCents * item.quantity,
      itemCount: totals.itemCount + item.quantity,
    }),
    {
      subtotalExGstCents: 0,
      gstCents: 0,
      totalInclGstCents: 0,
      itemCount: 0,
    },
  );
}

export function getCartDisplayMarket(cart: Cart): Readonly<{
  currency: MarketCurrency;
  taxJurisdiction: TaxJurisdiction;
}> | null {
  const markets = cart.items.map((item) => {
    const price = item.price as Partial<MarketPriceBreakdown>;
    return {
      currency: price.currency ?? "NZD",
      taxJurisdiction: price.taxJurisdiction ?? "NZ_GST",
    } as const;
  });
  const first = markets[0] ?? {
    currency: "NZD" as const,
    taxJurisdiction: "NZ_GST" as const,
  };
  return markets.every((entry) =>
    entry.currency === first.currency && entry.taxJurisdiction === first.taxJurisdiction
  ) ? Object.freeze(first) : null;
}

export function cartMatchesMarket(cart: Cart, market: Market): boolean {
  return cart.items.every((item) => {
    const price = item.price as Partial<MarketPriceBreakdown>;
    const itemMarket = price.market ?? (price.currency === "AUD" ? "AU" : "NZ");
    const expectedCurrency = market === "AU" ? "AUD" : "NZD";
    return itemMarket === market && (price.currency ?? "NZD") === expectedCurrency;
  });
}

export function applyAuthoritativeRepricing(
  cart: Cart,
  snapshot: RepricedCheckoutCart,
): Cart {
  const prices = new Map(snapshot.items.map((item) => [item.clientItemId, item]));
  if (prices.size !== cart.items.length || cart.items.some((item) => !prices.has(item.id))) {
    throw new Error("The repriced cart does not match the active cart.");
  }
  return Object.freeze({
    version: 1 as const,
    items: Object.freeze(cart.items.map((item) => {
      const repriced = prices.get(item.id)!;
      return Object.freeze({
        ...item,
        price: repriced.unitPrice,
        urgentFeeInclGstCents: repriced.urgentService.feeInclGstCents,
        deliveryPreference: snapshot.market === "AU" ? "post" as const : item.deliveryPreference,
      });
    })),
  });
}
