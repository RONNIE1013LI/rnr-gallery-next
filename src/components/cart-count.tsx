"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { LuShoppingCart } from "react-icons/lu";
import { parseStoredCart } from "@/domain/cart/browser-cart-repository";
import {
  EMPTY_CART_JSON,
  getCartSnapshot,
  subscribeToCart,
} from "@/domain/cart/browser-cart-events";
import { calculateCartTotals } from "@/domain/cart/cart";

export function CartCount({ onClick }: Readonly<{ onClick?: () => void }>) {
  const snapshot = useSyncExternalStore(
    subscribeToCart,
    getCartSnapshot,
    () => EMPTY_CART_JSON,
  );
  const count = calculateCartTotals(parseStoredCart(snapshot)).itemCount;

  return (
    <Link
      className="site-header__cart"
      href="/cart"
      aria-label={`Cart, ${count} items`}
      onClick={onClick}
    >
      <span className="site-header__cart-label">Cart</span>
      <LuShoppingCart className="site-header__cart-icon" aria-hidden="true" />
      <span className="site-header__cart-count" aria-hidden="true">{count}</span>
    </Link>
  );
}
