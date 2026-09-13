# R&R Gallery UI/UX audit implementation plan

Goal: Resolve the 24 findings in the supplied 12 September audit, preserve commerce rules, validate Preview, and make one normal main-based release only after all release gates pass.

Source: /Users/ronnieli/Downloads/rnr-ui-ux-audit-2026-09-12.md. The attached request expands acceptance to all Phase 1–4 requirements. Audit screenshots were not supplied; fresh captures are required. The findings table contains 9 P1 and 15 P2, despite its summary saying 8 P1.

## Baseline and safety

- Original checkout: main bf86ad59225dc28b3b1720eec081f637ab7c736c, dirty; preserve all changes and untracked files.
- Isolated branch: codex/ui-ux-audit-20260913, starts at origin/main 2af1b2878568da326c9cce94325cc2b2c6225bf5.
- Vercel live readback: Production branch main; the approved Production aliases resolve to dpl_523BDbDZXDuVGwkP42gkuAkLbhZa at that SHA.
- Staging: staging.rnrgallery.com -> dpl_Ei9tbWMmVyTvfsfT1kJuUuXJjcGW, same SHA, branch codex/invoice-email-release-20260912. Do not overwrite that other workstream's branch. Feature Preview and final Staging assignment must satisfy existing isolation policy without weakening its checks.
- No price, tax, shipping tariff, payment, auth configuration, database schema/migration, customer messaging, or business policy changes. No real order/payment or private photo tests.
- Keep screenshots, test images and diagnostics under ignored output/playwright; never commit credentials.

## Execution and evidence

For each bug: capture current browser state -> add behavior test -> observe expected failure -> minimal implementation -> passing targeted test -> browser After capture. A non-reproduced finding stays explicitly non-reproduced until stronger evidence exists.

### 1. Checkout reliability and presentation (findings 1, 6, 9–11)

Files: src/app/checkout/start/page.tsx, checkout loading/error boundary if needed, src/components/checkout-view.tsx, checkout-order-summary.tsx, address-form.tsx, associated tests and browser E2E.
- Verify both URL and actual form after guest navigation with populated browser cart, slow requests and navigation failure.
- Trace route and session/market data dependencies before fixing stale rendering. Add immediate accessible pending state, duplicate-click protection and customer-safe retry.
- Make guest the primary choice, retain account access; preserve all billing/delivery data and API contracts.
- Replace internal summary copy, mark required fields, reorder address inputs, provide linked/focused error summary.

### 2. Sizes, images and public contact privacy (findings 2, 3, 5)

Files: src/app/designs/[slug]/page.tsx, src/components/storefront.module.css, cart-view.tsx and tests, site-footer.tsx, src/app/contact/page.tsx.
- Measure size rows at five viewports; fix nowrap/two-column collision with one clear row per size.
- Verify standard product image selection and load failure; retain real product image and render labelled fallback after failure.
- Inventory public street address usages and retain legal/business documents; change ordinary Contact/Footer to supplied locality/appointment text.

### 3. Pixel data contract (finding 8)

Files: src/domain/analytics/meta.ts, meta-event.ts and their tests; trace upstream builders and controller before changing them.
- Record current browser payload source and runtime gates. Test NZD/AUD separately from numeric value for all requested events; invalid runtime values must never reach Pixel/CAPI.
- Preserve Pixel identity, event_id, fbp/fbc and existing purchase deduplication. Preview disables production tracking; distinguish payload tests from actual enabled-Pixel evidence.

### 4. Configuration and dates (findings 7, 12)

Files: src/components/product-configurator.tsx, banner-bundle-configurator.tsx, existing photo-upload components, storefront.module.css; existing date/pricing domain utilities and tests only as needed.
- Retain mounted inputs/state within accessible steps/accordion; size/format, photos, design details, timing and review.
- Preserve selections between steps and reasonable draft persistence without persisting private image bytes.
- Need-by entry maps to existing production-completion field using established business-day and delivery policy. Explicit estimates, unsafe-date/rush warnings; test weekends, holidays, timezone and stale dates without changing price or policy.
- Verify standard Canvas/Banner and bundle variants and mobile sticky summary/keyboard clearance.

### 5. Structured enquiry (finding 4)

Files: src/app/contact/page.tsx, scoped contact form component/tests and existing customer service intake integration.
- Trace the active monitored enquiry channel before adding any endpoint. Reuse existing intake/storage/attachment controls; source-labelled brief with validation and idempotent submission.
- Non-private test data only; automated tests stub external sends. Verify success/failure/upload/retry through isolated Staging without sending customers messages.
- No new DB schema or unmonitored inbox. Stop this item if existing channel cannot safely support it.

### 6. Discovery and shared visual system (findings 13–19, 22–24)

Files: design-gallery.tsx, design-gallery-occasion-filters.tsx, shared gallery cards, taxonomy.ts, site-header.tsx, site-footer.tsx, storefront.module.css, existing global brand tokens and review components, related tests.
- Reserve image aspect ratios, retain complete artwork, skeleton and labelled image failure.
- Compact desktop filters and modal mobile filters with selected count/chips/Apply/Clear/result count; preserve query and return links.
- Canonical labels, remove duplicate navigation destinations, compact category reviews, preserve homepage hero and strongest proof.
- Improve existing controls/tokens and measured contrast without redesigning the brand or unrelated admin UI.

### 7. Help, chat and accessibility (findings 20–23)

Files: existing help/policy content, chat panel and styles, affected shared components/tests.
- Source all FAQ/response-time claims from actual policies; log conflicts instead of inventing commitments.
- Keyboard focus, Escape/restore, error announcements, reduced motion, contrast, touch targets, zoom/reflow and semantic labels.

### 8. Acceptance and one release

- Unit/component tests per module; session-specific isolated integration databases through release:test:isolated; TypeScript, ESLint, production build; meaningful browser E2E and accessibility scan.
- Preview baseline/After screenshots at 390x844, 430x932, 768x1024, 1024x1366 and >=1366 desktop.
- Execute all five requested flows, inspect Console/network, analytics payloads, persistence, validation, failure/retry, SEO and performance/bundle changes.
- Full findings matrix with test commands/results, screenshot links, residual risks, SHA/status. Failed/skipped checks cannot count as passing.
- Before release fetch again, ensure Production identity, no overwrite of other work, clean committed branch, isolation and safe rollback. Only then normal main Git integration deployment; no direct Production CLI/promotion.
