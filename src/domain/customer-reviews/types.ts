export const CUSTOMER_REVIEW_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export const CUSTOMER_REVIEW_PERMISSION_STATUSES = ["PENDING", "GRANTED", "REVOKED"] as const;
export const CUSTOMER_RECOMMENDATION_STATUSES = [
  "RECOMMENDS",
  "DOES_NOT_RECOMMEND",
  "LEGACY_STAR_REVIEW",
] as const;
export const CUSTOMER_REVIEW_MEDIA_KINDS = [
  "AVATAR",
  "FEATURED_IMAGE",
  "PERMISSION_EVIDENCE",
] as const;

export type CustomerReviewStatus = (typeof CUSTOMER_REVIEW_STATUSES)[number];
export type CustomerReviewPermissionStatus = (typeof CUSTOMER_REVIEW_PERMISSION_STATUSES)[number];
export type CustomerRecommendationStatus = (typeof CUSTOMER_RECOMMENDATION_STATUSES)[number];
export type CustomerReviewMediaKind = (typeof CUSTOMER_REVIEW_MEDIA_KINDS)[number];

export type CustomerReviewMutationInput = Readonly<{
  reviewerName: string;
  originalReviewText: string;
  sourceReviewUrl: string | null;
  reviewDate: string;
  recommendationStatus: CustomerRecommendationStatus;
  editorialHeadline: string | null;
  productKey: string | null;
  productDisplayLabel: string | null;
  orderContext: string | null;
  isHomepageFeatured: boolean;
  displayOrder: number;
  permissionStatus: CustomerReviewPermissionStatus;
  permissionEvidenceReference: string | null;
  permissionNotes: string | null;
  lastVerifiedAt: string | null;
}>;

export type FacebookReviewSummaryInput = Readonly<{
  facebookRating: number;
  facebookRecommendationCount: number;
  facebookCountIsApproximate: boolean;
  facebookReviewsPageUrl: string;
  facebookLastVerifiedAt: string;
}>;

export type PublicCustomerReviewMedia = Readonly<{
  url: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
}>;

export type PublicCustomerReview = Readonly<{
  id: string;
  reviewerName: string;
  originalReviewText: string;
  sourceReviewUrl: string | null;
  reviewDate: string;
  recommendationStatus: "RECOMMENDS";
  editorialHeadline: string | null;
  productKey: string | null;
  productDisplayLabel: string | null;
  orderContext: string | null;
  isHomepageFeatured: boolean;
  avatar: PublicCustomerReviewMedia | null;
  featuredImage: PublicCustomerReviewMedia | null;
}>;

export type PublicFacebookReviewSummary = Readonly<{
  rating: number;
  recommendationCount: number;
  countIsApproximate: boolean;
  reviewsPageUrl: string;
  lastVerifiedAt: string;
}>;

export type PublicCustomerReviewSection = Readonly<{
  summary: PublicFacebookReviewSummary | null;
  featured: PublicCustomerReview;
  reviews: readonly PublicCustomerReview[];
}>;

export type AdminCustomerReviewMedia = Readonly<{
  id: string;
  kind: CustomerReviewMediaKind;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  adminUrl: string;
}>;

export type AdminCustomerReview = CustomerReviewMutationInput & Readonly<{
  id: string;
  sourcePlatform: "FACEBOOK";
  status: CustomerReviewStatus;
  publishedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  media: readonly AdminCustomerReviewMedia[];
}>;

export type AdminCustomerReviewFilter = Readonly<{
  status?: CustomerReviewStatus;
  permissionStatus?: CustomerReviewPermissionStatus;
  featured?: boolean;
}>;

export type AdminFacebookReviewSettings = Readonly<{
  draft: FacebookReviewSummaryInput | null;
  published: FacebookReviewSummaryInput | null;
}>;
