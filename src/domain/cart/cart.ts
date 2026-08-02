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
