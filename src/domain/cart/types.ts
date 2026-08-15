import type {
  DeliveryPreference,
  Orientation,
  PhotoSubmissionMethod,
} from "@/domain/configuration/types";
import type { PriceBreakdown } from "@/domain/pricing/types";

export const LEGACY_CART_STORAGE_KEY = "rnr-cart-v1";
export const CART_STORAGE_KEY = "rnr:commerce:v1:guest:cart";

export type CartItem = Readonly<{
  id: string;
  productKey: string;
  productSlug: string;
  productTitle: string;
  imageSrc: string;
  galleryDesignId?: string;
  sizeKey: string;
  sizeLabel: string;
  orientation?: Orientation;
  peoplePets: number;
  photoSubmissionMethod: PhotoSubmissionMethod;
  designText: string;
  notes: string;
  neededDate: string;
  urgentServiceConfirmed?: boolean;
  urgentFeeInclGstCents?: number;
  deliveryPreference: DeliveryPreference;
  quantity: number;
  price: PriceBreakdown;
  uploadReferences: readonly string[];
  mainPhotoUploadId?: string;
  extraBackgroundRemovalUploadIds?: readonly string[];
}>;

export type Cart = Readonly<{
  version: 1;
  items: readonly CartItem[];
}>;

export type CartTotals = Readonly<{
  subtotalExGstCents: number;
  gstCents: number;
  totalInclGstCents: number;
  itemCount: number;
}>;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CartRepository {
  load(): Cart;
  save(cart: Cart): void;
  clear(): void;
}
