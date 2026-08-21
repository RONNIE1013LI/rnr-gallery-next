import { createHmac, timingSafeEqual } from "node:crypto";

const selectorLifetimeMs = 30 * 24 * 60 * 60 * 1_000;
const selectorPattern = /^wrs1\.([a-z0-9]+)\.([A-Za-z0-9_-]{43})$/;

type ReviewIdentity = Readonly<{
  reviewId: string;
  generation: number;
  openedAt: Date;
  secret: string;
}>;

function selectorExpiry(openedAt: Date) {
  return openedAt.getTime() + selectorLifetimeMs;
}

function selectorMac(input: ReviewIdentity, expiresAtMs: number) {
  return createHmac("sha256", input.secret)
    .update(`website-review-selector\0${input.reviewId}\0${input.generation}\0${expiresAtMs}`)
    .digest("base64url");
}

export function createWebsiteReviewSelector(input: ReviewIdentity) {
  if (!input.reviewId || !Number.isSafeInteger(input.generation) || input.generation < 1 || input.secret.length < 32) {
    throw new Error("website_review_selector_input_invalid");
  }
  const expiresAtMs = selectorExpiry(input.openedAt);
  return `wrs1.${expiresAtMs.toString(36)}.${selectorMac(input, expiresAtMs)}`;
}

export function verifyWebsiteReviewSelector(input: ReviewIdentity & Readonly<{
  selector: string;
  now: Date;
}>) {
  const match = selectorPattern.exec(input.selector);
  if (!match || input.secret.length < 32) return false;
  const expiresAtMs = Number.parseInt(match[1], 36);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= input.now.getTime()) return false;
  if (expiresAtMs !== selectorExpiry(input.openedAt)) return false;
  const expected = Buffer.from(selectorMac(input, expiresAtMs), "base64url");
  const actual = Buffer.from(match[2], "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
