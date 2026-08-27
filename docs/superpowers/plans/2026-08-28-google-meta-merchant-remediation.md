# Google, Meta and Merchant Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the code-owned Google Ads, Merchant Center and Meta Ads readiness gaps, including Meta-first manual-order attribution, without enabling campaigns, charging customers, changing payment rules or creating a database migration.

**Architecture:** Extend the existing product registry, market quote, attribution and analytics pipelines. Public pages and feeds consume authoritative catalogue prices; one first-party consent state gates Google and Meta transports; Meta CAPI and manual-order conversion builders accept strict allowlisted contracts and reuse stable order/job identifiers for deduplication.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod, Drizzle ORM, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-28-google-meta-merchant-remediation-design.md`

## Global Constraints

- Do not enable campaigns, change budget/bidding or produce advertising spend.
- Do not create a real order, Stripe charge or Afterpay charge.
- Do not generate, edit or execute a database migration; the migration freeze remains active.
- Do not change Production data, Vercel environment variables, DNS, domains, payments or authentication.
- Never send customer photos, artwork, design text, memorial wording, delivery addresses or payment proofs to analytics.
- Keep `banner-bundle` excluded from automated feeds until an advertising-safe image is approved.
- Use `https://rnrgallery.com` for all code-owned public URLs and safe Meta source URLs.
- Preserve NZD/AUD authoritative pricing, cart identity isolation and checkout/payment behavior.

---

### Task 1: Complete public product landing pages

**Files:**
- Modify: `src/app/products/[slug]/page-content.tsx`
- Modify: `src/components/storefront.module.css`
- Test: `src/app/products/[slug]/page.test.tsx`
- Test: `src/app/au/products/[slug]/page.test.tsx`

**Interfaces:**
- Consumes: `schemaFromRegistry`, `deliveryCopy`, `quoteMarketConfiguration`.
- Produces: registry-derived size labels, market delivery copy, policy links and policy-consistent JSON-LD without incomplete optional shipping or return shapes.

- [ ] Write failing tests for all size labels, availability, five-business-day production, market delivery, Proof, Two revisions, `/returns-refunds` and `Start Your Design` preserving market/size/design.
- [ ] Run `npx vitest run 'src/app/products/[slug]/page.test.tsx' 'src/app/au/products/[slug]/page.test.tsx'`; expect RED on missing content.
- [ ] Pass registry size labels into `ProductPageContent` and render existing delivery/policy copy; do not add another price calculation or incomplete `shippingDetails`/`hasMerchantReturnPolicy` JSON-LD.
- [ ] Rerun focused tests and changed-file ESLint; expect PASS.
- [ ] Commit as `feat: complete public product landing details`.

### Task 2: Publish authoritative NZ/AU Merchant XML feeds

**Files:**
- Modify: `src/domain/catalogue/merchant-product-data.ts`
- Test: `src/domain/catalogue/merchant-product-data.test.ts`
- Create: `src/server/merchant/google-merchant-feed.ts`
- Create: `src/server/merchant/google-merchant-feed.test.ts`
- Create: `src/app/feeds/google-merchant-nz.xml/route.ts`
- Create: `src/app/feeds/google-merchant-au.xml/route.ts`
- Create: `src/app/feeds/google-merchant-routes.test.ts`

**Interfaces:**
- Consumes: `buildMerchantProductData(registry, market, siteUrl)`.
- Produces:

```ts
export function serializeGoogleMerchantFeed(input: Readonly<{
  market: Market;
  products: readonly MerchantProductData[];
  generatedAt: Date;
}>): string;
```

- [ ] Extend failing records tests for `.com` public links, brand, `new` condition, no configure URL, exact price/currency, stable IDs, `item_group_id`, visible size or variant, `identifier_exists=no` and shipping policy label; preserve Bundle exclusion.
- [ ] Add failing XML tests for escaping, Google namespace, `g:id`, `g:item_group_id`, `g:size`, `g:identifier_exists`, `g:price`, `g:availability`, `g:condition`, `g:brand`, `g:shipping_label`, public links and images. Do not invent unsupported returns URL elements.
- [ ] Run the three Merchant test files; expect RED.
- [ ] Implement projection and XML serializer through `quoteMarketConfiguration`; return XML content type and safe cache headers; never expose admin registry data.
- [ ] Verify focused tests, TypeScript and ESLint; expect PASS.
- [ ] Commit as `feat: add authoritative merchant feeds`.

### Task 3: Clarify send-later configuration

**Files:**
- Modify: `src/components/product-configurator.tsx`
- Modify if shared: `src/components/banner-bundle-configurator.tsx`
- Test: `src/components/product-configurator.test.tsx`
- Test if shared: `src/components/banner-bundle-configurator.test.tsx`

**Interfaces:** Existing `photoSubmissionMethod` state and Add-to-Cart validation remain authoritative.

- [ ] Add tests that `upload` remains disabled without files, `later` is enabled with `Add to Cart — Send Photos Later`, and both methods keep existing cart/order metadata.
- [ ] Run the configurator tests; expect RED only on the label.
- [ ] Implement only the label/state presentation; do not alter storage, file deletion, cart keys or order metadata.
- [ ] Rerun tests; expect PASS; commit as `fix: clarify send-later cart action`.

### Task 4: Add durable consent and gate transports

**Files:**
- Create: `src/domain/consent/advertising-consent.ts`
- Create: `src/domain/consent/advertising-consent.test.ts`
- Create: `src/components/consent-preferences.tsx`
- Create: `src/components/consent-preferences.test.tsx`
- Create: `src/app/api/consent/route.ts`
- Create: `src/app/api/consent/route-handler.ts`
- Create: `src/app/api/consent/route.test.ts`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/layout.test.ts`
- Modify: `src/components/analytics-runtime-controller.tsx`
- Modify: `src/components/analytics-runtime-controller.test.tsx`
- Modify: `src/domain/analytics/client.ts`
- Modify: `src/domain/analytics/client.test.ts`
- Modify: `src/components/meta-pixel-controller.tsx`
- Modify: `src/components/meta-pixel-controller.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**

```ts
export const ADVERTISING_CONSENT_COOKIE = "rnr-consent-v1";
export type AdvertisingConsent = Readonly<{
  version: 1;
  analytics: boolean;
  advertising: boolean;
  decidedAt: string;
}>;
export function parseAdvertisingConsent(value: string | undefined): AdvertisingConsent | null;
export function serializeAdvertisingConsent(value: AdvertisingConsent): string;
```

- [ ] Add parser tests for valid, malformed, oversized and unknown values plus one-year HttpOnly/Secure/SameSite Production cookie attributes. Add same-origin, bounded JSON and no-store API tests; decision time is server-generated.
- [ ] Add UI/controller tests: no choice loads no tags; Essential only keeps denied; Accept all enables eligible public transports; Manage saves independent values and allows later revocation; private-route gates remain.
- [ ] Run four consent/controller test files; expect RED.
- [ ] Implement the pure parser and an accessible compact preference surface using current visual tokens and a trusted same-origin HttpOnly-cookie write path.
- [ ] Feed server-parsed consent into both controllers and replace hard-coded defaults. Gate GA4 on analytics consent and Google Ads plus Meta on advertising consent; preserve the existing per-destination Purchase markers and private-route gates. Essential commerce must not depend on consent.
- [ ] Verify tests, TypeScript and ESLint; commit as `feat: add recorded advertising consent`.

### Task 5: Add allowlisted Meta CAPI and shared event IDs

**Files:**
- Create: `src/domain/analytics/meta-event.ts`
- Create: `src/domain/analytics/meta-event.test.ts`
- Create: `src/server/analytics/meta-capi-client.ts`
- Create: `src/server/analytics/meta-capi-client.test.ts`
- Create: `src/app/api/analytics/meta/route-handler.ts`
- Create: `src/app/api/analytics/meta/route.test.ts`
- Create: `src/app/api/analytics/meta/route.ts`
- Create: `src/server/analytics/meta-purchase.ts`
- Create: `src/server/analytics/meta-purchase.test.ts`
- Modify: `src/domain/analytics/meta.ts`
- Modify: `src/domain/analytics/meta.test.ts`
- Modify: `src/domain/analytics/attribution.ts`
- Modify: `src/components/attribution-capture.tsx`
- Modify: `src/components/analytics-link.tsx`
- Test: `src/components/analytics-link.test.tsx`
- Modify: `src/app/api/checkout/order/route-handler.ts`
- Modify: `src/server/orders/order-repository.ts`
- Modify: `src/server/orders/order-service.ts`
- Modify: `src/server/orders/drizzle-order-repository.ts`
- Modify only if needed for JSONB TypeScript typing with no SQL change: `src/server/db/schema/orders.ts`
- Modify: `src/server/payments/payment-service.ts`
- Modify: verified-payment webhook, return, reconciliation and order-payment route handlers that already invoke the payment service
- Test: corresponding attribution, order and verified-payment route/service tests

**Interfaces:**

```ts
export type SafeMetaEvent = Readonly<{
  name: "PageView" | "ViewContent" | "AddToCart" | "InitiateCheckout" | "Purchase" | "Contact" | "Lead";
  eventId: string;
  eventTime: number;
  sourceUrl: string;
  currency?: "NZD" | "AUD";
  value?: number;
  contentIds?: readonly string[];
  fbp?: string;
  fbc?: string;
  hashedEmail?: string;
  hashedPhone?: string;
}>;
export function normalizeMetaSourceUrl(input: URL): string;
export function buildMetaEventId(event: AnalyticsEvent, interactionId?: string): string;
```

- [ ] Add tests rejecting sensitive or unknown keys and stripping query/token data from source URLs; test server-only SHA-256 normalization and validation of consent-permitted `fbp` or `fbc`.
- [ ] Add route/client tests for missing credentials = no request, valid consent = allowlisted request, untrusted/oversized request = reject, provider failure = no commerce failure, and browser clients cannot submit Purchase or raw matching data.
- [ ] Add paid integration tests: pending, failed, cancelled and refunded states produce no CAPI Purchase; verified-paid commit schedules a failure-isolated post-commit observer; webhook, return and reconciliation retries reuse `purchase:<orderNumber>`; amount, currency and items come from the paid order snapshot.
- [ ] Add attribution tests: consent and `_fbp`/`_fbc` are read server-side at website order creation and stored only in the existing JSON attribution snapshot; advertising denied stores no Meta identifiers; legacy attribution remains readable with no migration.
- [ ] Run focused Meta tests; expect RED.
- [ ] Implement server-only credentials, bounded timeout and redacted errors; never expose access tokens to client code/logs. Missing approved matching identifiers or consent skips the server copy.
- [ ] Generate one event ID before Pixel/CAPI emission and add Contact events to Messenger, WhatsApp and Email without changing navigation. Browser non-Purchase requests use strict contracts; Purchase can only be built server-side from a verified paid order.
- [ ] Invoke Meta reporting only after the authoritative paid transaction commits, through a best-effort `after()` observer whose failure cannot change payment state. Do not place network calls inside the payment transaction or reuse the email/internal notification outbox.
- [ ] Verify tests, TypeScript and ESLint; commit as `feat: add consent-gated Meta CAPI`.

### Task 6: Route paid manual orders to Meta first and Google only with evidence

**Files:**
- Create: `src/domain/analytics/manual-order-attribution.ts`
- Create: `src/domain/analytics/manual-order-attribution.test.ts`
- Create: `src/server/analytics/manual-conversion-service.ts`
- Create: `src/server/analytics/manual-conversion-service.test.ts`
- Modify: `src/server/production/production-job-service.ts`
- Modify: `src/server/production/production-job-service.test.ts`
- Modify only if required by verified storage: `src/server/production/drizzle-production-job-repository.ts`
- Test if modified: `src/server/production/drizzle-production-job-repository.integration.test.ts`

**Interfaces:**

```ts
export type ManualConversionCandidate = Readonly<{
  transactionId: string;
  source: ProductionCustomerSource;
  paidAt: Date;
  value: number;
  currency: "NZD" | "AUD";
  meta?: SafeMetaEvent;
  google?: Readonly<{
    clickIdType: "gclid" | "gbraid" | "wbraid";
    clickId: string;
  }>;
}>;
export function buildManualConversionCandidate(input: ManualConversionInput): ManualConversionCandidate | null;
```

- [ ] Add routing tests: Messenger/Instagram/WhatsApp Meta-first; Google eligible only with real Google click evidence; original click overrides later contact; unpaid/refunded/zero/missing-consent produces no candidate.
- [ ] Add dedupe tests: manual-only uses immutable job number; linked website record reuses web order number; online/Payment Request purchase cannot become a second manual Purchase; repeated saves reuse IDs.
- [ ] Run focused tests; expect RED.
- [ ] Implement pure allowlisted custom-field readers and source routing; never infer Google origin from email/phone; hash matching values server-side only after consent validation.
- [ ] Add a post-commit, failure-isolated dispatch boundary. If reliable acknowledgement cannot use existing auditable/idempotent storage without schema change, keep network dispatch disabled and expose the candidate to a separately approved worker instead of claiming completion.
- [ ] Run focused and isolated-database integration tests; stop if the database identity is not proven non-Production.
- [ ] Commit as `feat: prepare source-routed manual conversions`.

### Task 7: Align Contact, Footer, Privacy and Returns

**Files:**
- Modify: `src/app/contact/page.tsx`
- Modify: `src/components/site-footer.tsx`
- Modify: `src/app/returns-refunds/page.tsx`
- Modify: `src/app/terms/page.tsx`
- Modify: `src/app/privacy/page.tsx`
- Modify: `src/app/legal-pages.test.tsx`
- Modify: `src/app/privacy/page.test.tsx`
- Modify: `src/components/site-shell.test.tsx`

**Interfaces:** Existing phone/email and public legal routes remain authoritative.

- [ ] Add failing tests for full physical identity on Contact/Footer and sections for custom/change-of-mind, damage, faulty/wrong item, approved-proof mismatch, evidence, remedies, return shipping, refund processing, NZ CGA and Australian Consumer Law.
- [ ] Add failing Privacy tests for recorded consent, GA/Meta browser measurement, conditional CAPI matching and explicit sensitive-data exclusions.
- [ ] Run legal/privacy/footer tests; expect RED.
- [ ] Implement precise, non-exclusionary copy across Returns and Terms; limit the approved design-start/50% rule to change-of-mind cancellation and state that it does not limit faulty, wrong, damaged or statutory remedies. Do not invent a returns window or guaranteed bank-processing time.
- [ ] Verify tests and commit as `docs: align contact and consumer policies`.

### Task 8: Re-verify domain, legacy redirects and crawlers

**Files:**
- Modify only if RED evidence proves a defect: `src/app/robots.ts`
- Modify only if RED evidence proves a defect: `src/server/seo/legacy-redirects.ts`
- Modify on demonstrated RED evidence: `src/server/seo/legacy-product-url.ts`
- Modify on demonstrated RED evidence: `src/server/seo/metadata.ts` and product metadata callers
- Test: `src/server/seo/legacy-product-url.test.ts`
- Test: existing domain, robots, redirect, canonical, sitemap and analytics tests found with `rg --files`.

**Interfaces:** Current `.com` canonical and redirects remain the base.

- [ ] Run the repository's existing focused SEO and domain tests found through `package.json` and `rg --files`; do not call the nonexistent `npm run audit:domains` script.
- [ ] Add missing assertions for one-hop redirects, generic legacy-product preservation of `utm_*`, `gclid`, `gbraid`, `wbraid`, `fbclid`, ordinary 404/410, no `/product/` crawler block, NZ and AU configure noindex or robots restrictions, AU-readiness-gated hreflang and public product/feed access.
- [ ] Apply only a demonstrated minimal fix; never send unmatched old pages to the homepage.
- [ ] Rerun tests and commit only if code changed.

### Task 9: Full verification, independent review and normal release

**Files:** No planned production-code file.

**Interfaces:** Consumes Tasks 1–8 and produces a verified release candidate plus an external-platform follow-up list.

- [ ] Inspect `git status --short`, `git diff origin/main...HEAD --check` and `git diff --stat origin/main...HEAD`; reject `.env`, credentials, logs, screenshots and temporary files.
- [ ] Run `npm ci`, `npm run typecheck`, `npm run lint`, `npm run db:check`, `npm test -- --run`, `npm run build`, and `git diff --check`. Database tests must use a proven isolated `TEST_DATABASE_URL`.
- [ ] Browser-check 390/768/1280/1440 product pages, consent, Contact/Returns, send-later, NZ/AU pricing, no overflow/broken images and network payload sensitive-data exclusion.
- [ ] Independently review price authority, paid-only Purchase, Google/Meta dedupe, consent, mutation security, URL stripping, PII allowlists, manual routing and no schema drift.
- [ ] Run `git fetch origin --prune`; if `origin/main` advanced, reconcile semantically and rerun focused tests, typecheck and build. Never force push.
- [ ] After every gate passes, push the feature and use the normal approved merge into `main`; allow Vercel automatic Production deployment only. Never run `vercel --prod`.
- [ ] Smoke public pages/feeds/consent/product/Contact/Returns/Cart/Checkout load, analytics gating, domain/canonical and Vercel SHA/ref/aliases without creating orders or charges.
- [ ] Report GA4↔Ads linking, Primary/Secondary conversion settings, historical Final URLs, Merchant ingestion, Meta credentials/verification and manual custom-field definitions as external gates; do not activate campaigns.
