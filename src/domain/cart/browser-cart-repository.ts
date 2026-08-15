import { emptyCart } from "./cart";
import { getActiveCartStorageKey } from "./browser-cart-scope";
import {
  type Cart,
  type CartItem,
  type CartRepository,
  type StorageLike,
} from "./types";

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

const galleryDesignIdPattern = /^[a-f0-9]{64}$/;

export function normalizeLegacyGraveCoverCart(cart: Cart): Cart {
  const items = cart.items.map((item) => {
    if (item.productKey !== "grave-cover" || item.orientation !== "portrait") {
      return item;
    }
    const { orientation, ...itemWithoutOrientation } = item;
    return orientation === "portrait"
      ? Object.freeze({ ...itemWithoutOrientation, sizeLabel: "100 × 200 cm" })
      : item;
  });
  return Object.freeze({ version: 1, items: Object.freeze(items) });
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
    (item.urgentServiceConfirmed === undefined ||
      typeof item.urgentServiceConfirmed === "boolean") &&
    (item.urgentFeeInclGstCents === undefined ||
      isNonNegativeInteger(item.urgentFeeInclGstCents)) &&
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
    const items = parsed.items.map((value) => {
      const item = value as CartItem;
      if (
        item.galleryDesignId === undefined ||
        galleryDesignIdPattern.test(item.galleryDesignId)
      ) {
        return Object.freeze({ ...item });
      }
      const safeItem = { ...item };
      delete safeItem.galleryDesignId;
      return Object.freeze(safeItem);
    });
    return normalizeLegacyGraveCoverCart({ version: 1, items });
  } catch {
    return emptyCart();
  }
}

export function createBrowserCartRepository(
  storage: StorageLike,
  storageKey = getActiveCartStorageKey(),
): CartRepository {
  return {
    load: () => parseStoredCart(storage.getItem(storageKey)),
    save: (cart) => storage.setItem(storageKey, JSON.stringify(cart)),
    clear: () => storage.removeItem(storageKey),
  };
}
