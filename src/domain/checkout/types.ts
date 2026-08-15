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

export type CanonicalCheckoutItemInput = Readonly<{
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
}>;

export type CanonicalCheckoutCartInput = Readonly<{
  version: 1;
  items: readonly CanonicalCheckoutItemInput[];
}>;

export type RepricedCheckoutItem = Readonly<{
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
  unitPrice: MarketPriceBreakdown;
  lineSubtotalExGstCents: number;
  lineGstCents: number;
  lineTotalInclGstCents: number;
}>;

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
