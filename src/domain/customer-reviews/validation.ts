import { z } from "zod";

import {
  CUSTOMER_RECOMMENDATION_STATUSES,
  CUSTOMER_REVIEW_PERMISSION_STATUSES,
  CUSTOMER_REVIEW_SOURCE_PLATFORMS,
  type CustomerReviewMutationInput,
  type FacebookReviewSummaryInput,
} from "./types";

const calendarDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string) {
  if (!calendarDatePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

const calendarDate = z.string().refine(isCalendarDate, "Enter a valid calendar date");

function trimmedOptional(max: number) {
  return z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? null : value,
    z.string().trim().max(max).nullable().optional(),
  ).transform((value) => value ?? null);
}

const facebookUrl = z.string()
  .trim()
  .min(1, "Enter a valid Facebook URL")
  .max(2_048, "Enter a valid Facebook URL")
  .transform((value, context) => {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        (host !== "facebook.com" && !host.endsWith(".facebook.com"))
      ) {
        throw new Error("invalid");
      }
      return url.toString();
    } catch {
      context.addIssue({
        code: "custom",
        message: "Enter a valid Facebook URL",
      });
      return z.NEVER;
    }
  });

const optionalSourceUrl = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? null : value,
  z.string().trim().max(2_048).nullable().optional(),
).transform((value, context) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("invalid");
    return url.toString();
  } catch {
    context.addIssue({ code: "custom", message: "Enter a valid source URL" });
    return z.NEVER;
  }
});

function isFacebookHost(host: string) {
  return host === "facebook.com" || host.endsWith(".facebook.com");
}

function isGoogleReviewHost(host: string) {
  return host === "google.com" || host.endsWith(".google.com") ||
    host === "google.co.nz" || host.endsWith(".google.co.nz") ||
    host === "google.com.au" || host.endsWith(".google.com.au") ||
    host === "g.page" || host.endsWith(".g.page") || host === "maps.app.goo.gl";
}

const optionalTimestamp = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? null : value,
  z.string().datetime({ offset: true }).nullable().optional(),
).transform((value) => value ?? null);

export const customerReviewMutationSchema = z.object({
  sourcePlatform: z.enum(CUSTOMER_REVIEW_SOURCE_PLATFORMS).default("FACEBOOK"),
  reviewerName: z.string().trim().min(1, "Reviewer name is required").max(120),
  originalReviewText: z.string().trim().min(1, "Review text is required").max(10_000),
  sourceReviewUrl: optionalSourceUrl,
  reviewDate: calendarDate,
  recommendationStatus: z.enum(CUSTOMER_RECOMMENDATION_STATUSES),
  editorialHeadline: trimmedOptional(240),
  productKey: trimmedOptional(160),
  productDisplayLabel: trimmedOptional(240),
  orderContext: trimmedOptional(500),
  isHomepageFeatured: z.boolean(),
  displayOrder: z.coerce.number().int().min(0).max(1_000_000),
  permissionStatus: z.enum(CUSTOMER_REVIEW_PERMISSION_STATUSES),
  permissionEvidenceReference: trimmedOptional(500),
  permissionNotes: trimmedOptional(2_000),
  lastVerifiedAt: optionalTimestamp,
}).strict().superRefine((value, context) => {
  if (value.sourceReviewUrl) {
    const host = new URL(value.sourceReviewUrl).hostname.toLowerCase();
    const valid = value.sourcePlatform === "GOOGLE"
      ? isGoogleReviewHost(host)
      : isFacebookHost(host);
    if (!valid) {
      context.addIssue({
        code: "custom",
        path: ["sourceReviewUrl"],
        message: `Enter a valid ${value.sourcePlatform === "GOOGLE" ? "Google" : "Facebook"} URL`,
      });
    }
  }
  if ((value.productKey === null) !== (value.productDisplayLabel === null)) {
    context.addIssue({
      code: "custom",
      path: ["productKey"],
      message: "Choose a valid associated product",
    });
  }
  if (value.isHomepageFeatured && value.permissionStatus !== "GRANTED") {
    context.addIssue({
      code: "custom",
      path: ["isHomepageFeatured"],
      message: "Permission must be granted before featuring a review",
    });
  }
  if (value.isHomepageFeatured && value.recommendationStatus !== "RECOMMENDS") {
    context.addIssue({
      code: "custom",
      path: ["isHomepageFeatured"],
      message: "Only a positive customer review can be featured",
    });
  }
});

export const facebookReviewSummarySchema = z.object({
  facebookRating: z.coerce.number().min(0).max(5),
  facebookRecommendationCount: z.coerce.number().int().min(0),
  facebookCountIsApproximate: z.boolean(),
  facebookReviewsPageUrl: facebookUrl,
  facebookLastVerifiedAt: calendarDate,
}).strict();

export function parseFacebookUrl(value: unknown): string {
  return facebookUrl.parse(value);
}

export function parseCustomerReviewMutation(value: unknown): CustomerReviewMutationInput {
  return customerReviewMutationSchema.parse(value);
}

export function parseFacebookReviewSummary(value: unknown): FacebookReviewSummaryInput {
  return facebookReviewSummarySchema.parse(value);
}
