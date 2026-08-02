import type {
  Orientation,
  PhotoSubmissionMethod,
} from "@/domain/configuration/types";
import type { PriceBreakdown } from "@/domain/pricing/types";

export class InvalidCheckoutCartError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InvalidCheckoutCartError";
  }
}

export type CanonicalCheckoutItemInput = Readonly<{
  clientItemId: string;
  productKey: string;
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
  unitPrice: PriceBreakdown;
  lineSubtotalExGstCents: number;
  lineGstCents: number;
  lineTotalInclGstCents: number;
}>;

export type RepricedCheckoutCart = Readonly<{
  version: 1;
  orderDate: string;
  items: readonly RepricedCheckoutItem[];
  subtotalExGstCents: number;
  gstCents: number;
  totalInclGstCents: number;
  itemCount: number;
  cartDigest: string;
}>;
