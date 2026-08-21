import { createHmac, timingSafeEqual } from "node:crypto";

const selectorWindowMs = 24 * 60 * 60 * 1_000;
const selectorLifetimeMs = 30 * selectorWindowMs;
const selectorPattern = /^wrs1\.([a-z0-9]+)\.([A-Za-z0-9_-]{43})$/;

type ReviewIdentity = Readonly<{
  reviewId: string;
  generation: number;
  secret: string;
}>;

function selectorExpiry(now: Date) {
  return Math.floor(now.getTime() / selectorWindowMs) * selectorWindowMs + selectorLifetimeMs;
}

function selectorMac(input: ReviewIdentity, expiresAtMs: number) {
  return createHmac("sha256", input.secret)
    .update(`website-review-selector\0${input.reviewId}\0${input.generation}\0${expiresAtMs}`)
    .digest("base64url");
}

function canonicalSelector(input: ReviewIdentity, expiresAtMs: number) {
  return `wrs1.${expiresAtMs.toString(36)}.${selectorMac(input, expiresAtMs)}`;
}

export function createWebsiteReviewSelector(input: ReviewIdentity & Readonly<{ now: Date }>) {
  if (
    !input.reviewId
    || !Number.isSafeInteger(input.generation)
    || input.generation < 1
    || input.secret.length < 32
    || !Number.isFinite(input.now.getTime())
  ) {
    throw new Error("website_review_selector_input_invalid");
  }
  return canonicalSelector(input, selectorExpiry(input.now));
}

export function verifyWebsiteReviewSelector(input: ReviewIdentity & Readonly<{
  selector: string;
  now: Date;
}>) {
  const match = selectorPattern.exec(input.selector);
  if (!match || input.secret.length < 32) return false;
  const expiresAtMs = Number.parseInt(match[1], 36);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= input.now.getTime()) return false;
  if (expiresAtMs.toString(36) !== match[1]) return false;
  const expected = Buffer.from(canonicalSelector(input, expiresAtMs));
  const actual = Buffer.from(input.selector);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
