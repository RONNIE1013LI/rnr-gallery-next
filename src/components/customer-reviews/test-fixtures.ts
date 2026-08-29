import type { PublicCustomerReview } from "@/domain/customer-reviews/types";

export const featuredReview: PublicCustomerReview = {
  id: "11111111-1111-4111-8111-111111111111",
  sourcePlatform: "FACEBOOK",
  reviewerName: "Aroha Te Rangi",
  originalReviewText: "The canvas brought our family photographs together.\n\nWe recommend R&R Gallery.",
  sourceReviewUrl: "https://www.facebook.com/example/reviews/1",
  reviewDate: "2026-08-20",
  recommendationStatus: "RECOMMENDS",
  editorialHeadline: "Our family together again",
  productKey: "digital-oil-painting-canvas",
  productDisplayLabel: "Digital Oil Painting Canvas",
  orderContext: "Custom family canvas",
  isHomepageFeatured: true,
  avatar: null,
  featuredImage: null,
};

export const secondReview: PublicCustomerReview = {
  ...featuredReview,
  id: "22222222-2222-4222-8222-222222222222",
  sourcePlatform: "GOOGLE",
  reviewerName: "Mereana K.",
  originalReviewText: "Amazing service and a beautiful result.",
  sourceReviewUrl: null,
  editorialHeadline: null,
  isHomepageFeatured: false,
};
