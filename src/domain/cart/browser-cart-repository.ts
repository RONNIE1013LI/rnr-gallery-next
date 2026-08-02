import { emptyCart } from "./cart";
import {
  CART_STORAGE_KEY,
  type Cart,
  type CartItem,
  type CartRepository,
  type StorageLike,
} from "./types";

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isCartItem(value: unknown): value is CartItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const price = item.price as Record<string, unknown> | undefined;

  return (
    typeof item.id === "string" &&
    typeof item.productKey === "string" &&
    typeof item.productSlug === "string" &&
    typeof item.productTitle === "string" &&
    typeof item.imageSrc === "string" &&
    typeof item.sizeKey === "string" &&
    typeof item.sizeLabel === "string" &&
    (item.orientation === undefined ||
      item.orientation === "landscape" ||
      item.orientation === "portrait") &&
    isNonNegativeInteger(item.peoplePets) &&
    (item.photoSubmissionMethod === "upload" ||
      item.photoSubmissionMethod === "later") &&
    typeof item.designText === "string" &&
    typeof item.notes === "string" &&
    typeof item.neededDate === "string" &&
    (item.deliveryPreference === "post" ||
      item.deliveryPreference === "pickup") &&
    Number.isInteger(item.quantity) &&
    Number(item.quantity) >= 1 &&
    price !== undefined &&
    Array.isArray(price.lines) &&
    isNonNegativeInteger(price.subtotalExGstCents) &&
    isNonNegativeInteger(price.gstCents) &&
    isNonNegativeInteger(price.totalInclGstCents) &&
    Array.isArray(item.uploadReferences) &&
    item.uploadReferences.every((reference) => typeof reference === "string")
  );
}

export function parseStoredCart(value: string | null): Cart {
  if (!value) return emptyCart();

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.items) ||
      !parsed.items.every(isCartItem)
    ) {
      return emptyCart();
    }
    return Object.freeze({ version: 1, items: Object.freeze(parsed.items) });
  } catch {
    return emptyCart();
  }
}

export function createBrowserCartRepository(
  storage: StorageLike,
): CartRepository {
  return {
    load: () => parseStoredCart(storage.getItem(CART_STORAGE_KEY)),
    save: (cart) => storage.setItem(CART_STORAGE_KEY, JSON.stringify(cart)),
    clear: () => storage.removeItem(CART_STORAGE_KEY),
  };
}
