"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { getCartSnapshot, subscribeToCart } from "@/domain/cart/browser-cart-events";
import { getActiveCartStorageKey } from "@/domain/cart/browser-cart-scope";
import { parseStoredCart } from "@/domain/cart/browser-cart-repository";
import type { CartItem } from "@/domain/cart/types";
import { ProductConfigurator, type ProductConfiguratorProps } from "./product-configurator";
import { BannerBundleConfigurator } from "./banner-bundle-configurator";
import { editableCartItem } from "./cart-configuration-edit";

type Props = ProductConfiguratorProps & { editItemId: string };
function snapshot() {
  try { return JSON.stringify([getActiveCartStorageKey(), getCartSnapshot()]); }
  catch { return JSON.stringify([getActiveCartStorageKey(), ""]); }
}
function UnavailableEdit() {
  return <section><p role="alert">This configuration is unavailable for the current customer. Return to your cart and open the item again.</p><Link href="/cart">Return to cart</Link></section>;
}
function LoadedEditor({ props, storageKey, item }: { props: Props; storageKey: string; item: CartItem | undefined }) {
  const [original] = useState(() => ({ storageKey, item }));
  if (!original.item || !item || storageKey !== original.storageKey) return <UnavailableEdit />;
  const Configurator = props.product.key === "banner-bundle" ? BannerBundleConfigurator : ProductConfigurator;
  return <>
    <p>Editing your cart item. Review the price and production service for {props.market === "AU" ? "Australia" : "New Zealand"} before saving. Your original item and quantity stay in your cart until you save.</p>
    <p>Prices are per item. Saving keeps your quantity of {item.quantity}.</p>
    <p>Saved photos are retained. Previews and original filenames are unavailable here.</p>
    <Link href="/cart">Cancel editing</Link>
    <Configurator {...props} editingItem={original.item} editingCartStorageKey={original.storageKey} initialSizeKey={original.item.sizeKey} />
  </>;
}
export function CartConfigurationEditor(props: Props) {
  const current = useSyncExternalStore(subscribeToCart, snapshot, () => "");
  if (!current) return <p role="status">Loading your cart configuration…</p>;
  const [storageKey, storedCart] = JSON.parse(current) as [string, string];
  const item = editableCartItem(parseStoredCart(storedCart), props.editItemId, props.product.slug, props.schema);
  return <LoadedEditor key={`${props.editItemId}:${props.product.key}:${props.market ?? "NZ"}`} props={props} storageKey={storageKey} item={item} />;
}
