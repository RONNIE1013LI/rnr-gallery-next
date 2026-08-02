"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { parseStoredCart } from "@/domain/cart/browser-cart-repository";
import {
  EMPTY_CART_JSON,
  getCartSnapshot,
  subscribeToCart,
} from "@/domain/cart/browser-cart-events";
import { calculateCartTotals } from "@/domain/cart/cart";

export function CartCount() {
  const snapshot = useSyncExternalStore(
    subscribeToCart,
    getCartSnapshot,
    () => EMPTY_CART_JSON,
  );
  const count = calculateCartTotals(parseStoredCart(snapshot)).itemCount;

  return (
    <Link className="site-header__cart" href="/cart" aria-label={`Cart, ${count} items`}>
      Cart <span aria-hidden="true">{count}</span>
    </Link>
  );
}
