# Google Ads Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing R&R Gallery Next.js storefront technically ready for future Google Search Ads and Shopping traffic without activating Google services or changing core commerce behavior.

**Architecture:** Extend the current App Router, product registry, gallery service, cart identity scope and component design system. Public SEO and landing content remains server-rendered; transactional routes remain noindex. Analytics is a typed, disabled-by-default adapter with identity-scoped attribution and no PII.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Testing Library, Playwright CLI, Lighthouse.

## Global Constraints

- Preserve the existing homepage design direction and all authentication, payment, order, production, upload and admin authorization logic.
- Preserve Guest/User cart isolation and immediate sign-out reset behavior.
- Do not activate Google tags, Merchant Center, Search Console, DNS, redirects or Consent Mode.
- Do not send customer names, contact details, addresses, design text, file names, image URLs or memorial information to analytics.
- Use integer cents for GST calculations and NZD display; do not change stored base pricing.
- Use existing components and styles; no broad dependency upgrades or `npm audit fix --force`.
- Commit each implementation phase independently after its tests pass.

---

### Task 1: Public SEO and index control

**Files:**
- Create: `src/server/seo/metadata.ts`
- Modify: public route `page.tsx` files, `src/app/robots.ts`, `src/app/sitemap.ts`, `src/components/structured-data.tsx`
- Test: `src/app/seo-routes.test.ts`, route-level page tests

**Interfaces:**
- Produces `buildPublicMetadata({ title, description, path, image })` and `privateMetadata(title)`.
- Produces an absolute canonical, per-page Open Graph/Twitter fields and explicit robots policy.

- [ ] Write tests that fail when public canonical URLs are not absolute, private routes are indexable, sitemap leaks transactional URLs, JSON-LD does not parse, or visible and structured product prices differ.
- [ ] Run focused Vitest files and confirm the expected failures.
- [ ] Add the metadata helpers, route metadata, noindex layouts and safe sitemap/robots entries.
- [ ] Run focused tests, TypeScript and ESLint.
- [ ] Commit as `feat: strengthen storefront technical SEO`.

### Task 2: Public design detail routes

**Files:**
- Create: `src/domain/gallery/public-design-slug.ts`, `src/app/designs/[slug]/page.tsx`, focused styles/components as needed
- Modify: `src/server/gallery/public-gallery-service.ts`, `src/components/design-gallery.tsx`, `src/app/sitemap.ts`
- Test: slug, service, route metadata and gallery navigation tests

**Interfaces:**
- Produces stable slugs in the form `<readable-title>-<short-id>` while retaining the immutable design ID.
- Produces `/designs/[slug]` as the public canonical and keeps `/products/[slug]/configure?design=<id>` transactional/noindex.

- [ ] Write failing tests for duplicate titles, invalid/private designs, configure links and concrete metadata.
- [ ] Run tests and confirm the expected failures.
- [ ] Implement slug resolution, detail rendering, related designs, breadcrumbs and sitemap entries without copying images.
- [ ] Run focused tests, TypeScript and ESLint.
- [ ] Commit as `feat: add indexable design detail pages`.

### Task 3: Consumer pricing, configurator entry and help content

**Files:**
- Modify: `src/domain/money.ts`, product/cart/checkout/order summary components, `src/components/product-configurator.tsx`, `src/components/site-shell.tsx`
- Create: reusable public price/trust components and `/about`, `/contact`, `/help`, `/shipping-delivery` pages
- Test: money, product card/configurator, cart/checkout summaries, content routes and identity regression tests

**Interfaces:**
- Produces `formatNzdInclGstFromExGstCents` and paired inclusive/exclusive price presentation using integer cents.
- Produces explicit `upload-now` and `send-later` choices while retaining uploads when switching.

- [ ] Write failing tests for GST rounding, NZ$ labels, send-later validation, trust copy and public help routes.
- [ ] Run tests and confirm the expected failures.
- [ ] Implement shared pricing/trust UI, upload method copy and public information routes using only confirmed business facts.
- [ ] Run focused tests including commerce identity isolation, TypeScript and ESLint.
- [ ] Commit as `feat: improve ad traffic conversion clarity`.

### Task 4: Three product-intent landing pages

**Files:**
- Create: `src/components/product-landing-page.tsx` and route pages for roll-up banner, wall banner and photo canvas
- Modify: shared styles and sitemap
- Test: reusable landing component, route metadata, CTA and JSON-LD tests

**Interfaces:**
- Produces three distinct public pages whose primary CTA targets the matching configurator and whose Product/Offer data comes from the product registry.

- [ ] Write failing tests for route-specific headings, sizes, inclusive prices, CTA targets and parseable structured data.
- [ ] Run tests and confirm the expected failures.
- [ ] Implement the shared template and three truthful route configurations using first-party product assets only.
- [ ] Run focused tests, TypeScript and ESLint.
- [ ] Commit as `feat: add search ads product landing pages`.

### Task 5: Disabled typed analytics and attribution

**Files:**
- Create: `src/lib/analytics/events.ts`, `src/lib/analytics/client.ts`, `src/lib/analytics/attribution.ts`, `src/lib/analytics/purchase.ts`
- Modify: limited existing interaction points and order metadata creation path only where safe
- Test: analytics payload, disabled adapter, attribution identity isolation and purchase idempotency tests

**Interfaces:**
- Produces typed event payloads for the requested ecommerce and lead events.
- Produces a no-network adapter when configuration is absent and an allowlisted, identity-scoped attribution record.

- [ ] Write failing tests for purchase values, transaction IDs, reload idempotency, disabled behavior, PII rejection and sign-out isolation.
- [ ] Run tests and confirm the expected failures.
- [ ] Implement strict event schemas, dataLayer adapter boundary and identity-scoped session attribution without loading Google scripts.
- [ ] Run focused tests including cart identity regressions, TypeScript and ESLint.
- [ ] Commit as `feat: prepare disabled analytics interfaces`.

### Task 6: Evidence-based performance improvements

**Files:**
- Modify only files identified by Lighthouse/resource evidence
- Document: `docs/google-ads-readiness-code.md`
- Test: affected component tests plus Lighthouse before/after measurements

**Interfaces:**
- Keeps original upload storage quality while serving correctly sized storefront and gallery images.

- [ ] Record Lighthouse baseline for home, shop, gallery, two configurators, cart and checkout.
- [ ] Identify concrete LCP, image, bundle, caching or prefetch causes.
- [ ] Add a failing regression test for each chosen code change.
- [ ] Implement the smallest evidence-backed fixes and rerun focused tests.
- [ ] Record after measurements and commit as `perf: reduce storefront ad landing cost`.

### Task 7: Full regression, readiness documentation and migration preparation

**Files:**
- Create: `docs/google-ads-readiness-code.md`, `docs/seo/legacy-url-map.csv`
- Add or modify: Playwright coverage only where the existing browser suite supports it

**Interfaces:**
- Produces the completed/deferred readiness record and a non-activated legacy URL mapping artifact.

- [ ] Run TypeScript, ESLint, full Vitest with `.env.local`, production build, Playwright desktop/mobile flows and basic accessibility checks.
- [ ] Verify SEO metadata, sitemap exclusions, design journey, upload/send-later behavior, order access safety and cart identity isolation.
- [ ] Create the readiness document with completed, disabled and externally blocked sections; create a verified legacy mapping or template without touching the old site.
- [ ] Rerun fresh verification commands and inspect `git diff`/commit history.
- [ ] Commit as `test: verify Google Ads readiness flows`.

## Baseline captured 2026-08-16

- TypeScript: passed.
- ESLint: passed.
- Vitest with `.env.local`: 248 files, 1597 tests passed.
- Production build: passed with existing local environment plus a build-only Auth URL and secret.
- Lighthouse mobile: Home 87/LCP 3.8s, Shop 89/3.8s, Gallery 98/2.4s, Canvas configure 89/3.7s, Roll-up configure 96/2.7s, Cart 98/2.4s, Checkout 95/3.0s; CLS 0 on all measured routes.
