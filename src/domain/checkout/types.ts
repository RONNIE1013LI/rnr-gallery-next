import type { BannerBundleComponentCustomization } from "@/domain/bundles/banner-bundle";
import type {
  Orientation,
  PhotoSubmissionMethod,
} from "@/domain/configuration/types";
import type { Market, MarketCurrency, TaxJurisdiction } from "@/domain/markets/types";
import type { MarketPriceBreakdown } from "@/domain/pricing/types";

export class InvalidCheckoutCartError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InvalidCheckoutCartError";
  }
}

export type GalleryDesignSnapshot = Readonly<{
  id: string;
  title: string;
  contentHash: string;
  productSlug: string;
  imageUrl: string;
}>;

export type CustomCheckoutItemInput = Readonly<{
  kind?: "custom";
  clientItemId: string;
  productKey: string;
  galleryDesignId?: string;
  sizeKey: string;
  orientation?: Orientation;
  peoplePets: number;
  photoSubmissionMethod: PhotoSubmissionMethod;
  designText: string;
  notes: string;
  neededDate: string;
  urgentServiceConfirmed?: boolean;
  quantity: number;
  uploadReferences: readonly string[];
  mainPhotoUploadId?: string;
  extraBackgroundRemovalUploadIds?: readonly string[];
  bundleComponents?: readonly BannerBundleComponentCustomization[];
}>;

export type SupplyCheckoutItemInput = Readonly<{
  kind: "supply";
  clientItemId: string;
  supplyProductId: string;
  supplyVariantId?: string;
  quantity: number;
  galleryDesignId?: never;
  productKey?: never;
  sizeKey?: never;
  orientation?: never;
  peoplePets?: never;
  photoSubmissionMethod?: never;
  designText?: never;
  notes?: never;
  neededDate?: never;
  urgentServiceConfirmed?: never;
  uploadReferences?: never;
  mainPhotoUploadId?: never;
  extraBackgroundRemovalUploadIds?: never;
  bundleComponents?: never;
}>;
export type CanonicalCheckoutItemInput = CustomCheckoutItemInput | SupplyCheckoutItemInput;

export type SupplyPurchaseSnapshot = Readonly<{
  productId: string;
  variantId: string | null;
  title: string;
  slug: string;
  sku: string;
  variantLabel: string;
  unitPriceCents: number;
  trackInventory: boolean;
  stockQuantity: number | null;
  weightGrams: number | null;
  packedLengthMm: number | null;
  packedWidthMm: number | null;
  packedHeightMm: number | null;
  pickupAllowed: boolean;
  shippingAllowed: boolean;
}>;
export type SuppliesPurchaseService = Readonly<{
  resolve(productId: string, variantId?: string): Promise<SupplyPurchaseSnapshot>;
}>;
export function supplySelectionKey(productId: string, variantId?: string | null): string {
  return variantId ? `${productId}:${variantId}` : productId;
}

export type CanonicalCheckoutCartInput = Readonly<{
  version: 1;
  items: readonly CanonicalCheckoutItemInput[];
}>;

export type RepricedCustomCheckoutItem = Readonly<{
  kind?: "custom";
  clientItemId: string;
  productKey: string;
  productSlug: string;
  productTitle: string;
  galleryDesign?: GalleryDesignSnapshot;
  sizeKey: string;
  sizeLabel: string;
  orientation?: Orientation;
  peoplePets: number;
  photoSubmissionMethod: PhotoSubmissionMethod;
  designText: string;
  notes: string;
  neededDate: string;
  urgentServiceConfirmed: boolean;
  urgentService: Readonly<{
    workingDays: number;
    feeInclGstCents: number;
  }>;
  quantity: number;
  uploadReferences: readonly string[];
  mainPhotoUploadId?: string;
  extraBackgroundRemovalUploadIds?: readonly string[];
  bundleComponents?: readonly BannerBundleComponentCustomization[];
  unitPrice: MarketPriceBreakdown;
  lineSubtotalExGstCents: number;
  lineGstCents: number;
  lineTotalInclGstCents: number;
}>;

export type RepricedSupplyCheckoutItem = Readonly<{
  kind: "supply";
  clientItemId: string;
  supplyProductId: string;
  supplyVariantId?: string;
  productKey: string;
  productSlug: string;
  productTitle: string;
  sizeKey: string;
  sizeLabel: string;
  supplySnapshot: SupplyPurchaseSnapshot;
  quantity: number;
  unitPrice: MarketPriceBreakdown;
  lineSubtotalExGstCents: number;
  lineGstCents: number;
  lineTotalInclGstCents: number;
  galleryDesign?: never;
  orientation?: never;
  peoplePets?: never;
  photoSubmissionMethod?: never;
  designText?: never;
  notes?: never;
  neededDate?: never;
  urgentServiceConfirmed?: never;
  urgentService?: never;
  uploadReferences?: never;
  mainPhotoUploadId?: never;
  extraBackgroundRemovalUploadIds?: never;
  bundleComponents?: never;
}>;
export type RepricedCheckoutItem = RepricedCustomCheckoutItem | RepricedSupplyCheckoutItem;

export type RepricedCheckoutCart = Readonly<{
  version: 1;
  market: Market;
  currency: MarketCurrency;
  taxJurisdiction: TaxJurisdiction;
  taxRateBasisPoints: number;
  priceBookRevision: number;
  orderDate: string;
  items: readonly RepricedCheckoutItem[];
  subtotalExGstCents: number;
  gstCents: number;
  totalInclGstCents: number;
  discountCents: number;
  designSurchargeCents: number;
  itemCount: number;
  cartDigest: string;
}>;
