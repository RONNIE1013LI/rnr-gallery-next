# NZ and Australia Market Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add independently managed NZD and AUD market price books, market-aware storefront and checkout repricing, AUD Stripe charging, and immutable order pricing snapshots while keeping Australia disabled until its complete fixed AUD price book is approved.

**Architecture:** Upgrade the existing versioned product registry into the single price-book authority. Preserve the structural product catalogue and exact current NZ retail totals, allow incomplete AUD draft values while AU is disabled, and enforce completeness server-side before AU checkout can ever open. Resolve market from explicit AU routes or a non-sensitive cookie for browsing, then treat checkout shipping country as authoritative and rebuild product, option, shipping, tax and discount totals from the active registry revision. Store that quote revision and full pricing snapshot on the order; derive Stripe currency only from the stored order.

**Tech Stack:** Next.js App Router, React, TypeScript, Zod, Drizzle/PostgreSQL, Stripe, Vitest, Testing Library, Playwright.

## Global constraints

- Do not invent, copy or convert AUD prices. Unconfigured AUD values remain missing, and missing values fail AU checkout closed.
- Do not change any current NZ final retail amount, completed order or completed payment.
- AU defaults to disabled, noindex and absent from sitemap, Merchant output, public navigation and advertising links.
- NZ continues to use the current live NZD carrier flow. AU shipping uses fixed Admin-maintained AUD methods.
- The stored AU price is always the final customer price. Enabling AU GST extracts included tax; it never adds tax at checkout.
- Shipping destination country is authoritative at checkout and invalidates the previous market quote and shipping selection.
- Preserve Guest/User A/User B cart, checkout and payment-recovery isolation. Market is an additional quote dimension, never an identity namespace replacement.
- Browser totals, market, currency and tax are never payment authorities.
- Use integer cents and basis points; do not add a floating-point or live-FX path.
- Do not deploy or publicly enable AU during this plan.

---

### Task 1: Record a clean baseline

**Files:**
- No source changes.

- [ ] **Step 1: Confirm worktree scope**

Run: `git status --short && git log -3 --oneline`

Record unrelated untracked files and exclude them from every commit.

- [ ] **Step 2: Run current money, cart, checkout, order and Stripe tests**

Run:

```bash
npm test -- \
  src/domain/catalogue/product-registry.test.ts \
  src/domain/pricing/pricing.test.ts \
  src/domain/configuration/quote.test.ts \
  src/domain/cart/browser-cart-scope.test.ts \
  src/domain/checkout/reprice-cart.test.ts \
  src/server/checkout/checkout-service.test.ts \
  src/server/orders/order-service.test.ts \
  src/server/orders/drizzle-order-repository.test.ts \
  src/server/payments/stripe-provider.test.ts
```

Expected: PASS. If a pre-existing failure appears, record it before implementation and do not misreport it as caused by this feature.

- [ ] **Step 3: Run the static baseline**

Run: `npm run typecheck && npm run lint`

Expected: both exit 0.

### Task 2: Add market primitives and currency formatting

**Files:**
- Create: `src/domain/markets/types.ts`
- Create: `src/domain/markets/market.ts`
- Create: `src/domain/markets/market.test.ts`
- Modify: `src/domain/money.ts`
- Test: `src/domain/pricing/pricing.test.ts`

**Interfaces:**
- `Market = "NZ" | "AU"`
- `MarketCurrency = "NZD" | "AUD"`
- `TaxJurisdiction = "NZ_GST" | "AU_GST" | "NONE"`
- `marketForCountry`, `currencyForMarket`, `formatMarketMoney`, and integer/basis-point included-tax extraction.

- [ ] **Step 1: Write failing tests**

Cover NZ/AU country mapping, explicit `NZ$…` and `A$… AUD` formatting, 15% NZ included-tax extraction, AU unregistered zero tax, and registered AU 10% included-tax extraction without changing the gross amount.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/domain/markets/market.test.ts src/domain/pricing/pricing.test.ts`

Expected: FAIL because the market module and formatter do not exist.

- [ ] **Step 3: Implement the pure primitives**

Use integer cents and tax-rate basis points. Reject unsafe or negative cents, unsupported countries and invalid rates. Keep `formatNzd` as a compatibility wrapper over `formatMarketMoney`.

- [ ] **Step 4: Verify GREEN**

Run the same test files and expect PASS.

- [ ] **Step 5: Commit**

Commit: `feat: add NZ and AU market primitives`

### Task 3: Upgrade the product registry to dual price books

**Files:**
- Create: `src/domain/catalogue/market-price-book.ts`
- Create: `src/domain/catalogue/market-price-book.test.ts`
- Modify: `src/domain/catalogue/product-registry.ts`
- Modify: `src/domain/catalogue/product-registry.test.ts`
- Modify: `src/server/admin/product-registry-service.ts`
- Test: `src/server/admin/product-registry-service.test.ts`
- Test: `src/server/admin/product-registry-service.integration.test.ts`

**Interfaces:**
- Product registry schema version 2.
- `markets.NZ` contains a complete enabled NZD price book derived from current final retail values.
- `markets.AU` contains disabled AUD settings and nullable/missing draft price cells.
- Price keys cover sizes, extra photos, background removal, people/pets, urgent service, active service/design surcharges and fixed shipping methods.
- `getMarketCompleteness(registry, market)` and `assertMarketCheckoutReady` return typed missing-key errors.

- [ ] **Step 1: Write migration and completeness tests**

Assert that parsing schema-version-1 data produces schema version 2 with identical NZ final amounts, no generated AUD values, AU disabled, and a deterministic missing-key report. Assert AU cannot be enabled while any required price is missing and can be enabled only after all referenced keys and shipping methods are filled.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- \
  src/domain/catalogue/market-price-book.test.ts \
  src/domain/catalogue/product-registry.test.ts \
  src/server/admin/product-registry-service.test.ts
```

Expected: FAIL because registry version 2 and completeness validation do not exist.

- [ ] **Step 3: Implement the minimum schema migration**

Keep product/size/option keys immutable. Normalize version-1 documents on read, preserve existing product content updates, derive NZ gross values exactly once from each field's current tax semantics, and leave every AUD commercial value unconfigured. Use the environment defaults only for version-zero AU tax settings (`false`, `0.10`), with published Admin values authoritative thereafter.

- [ ] **Step 4: Protect publication**

Allow incomplete AU drafts only while disabled. Reject an enabled incomplete market and reject unknown, duplicate, unsafe or negative price entries. Preserve current revision, audit, origin, permission and idempotency behavior.

- [ ] **Step 5: Verify GREEN**

Run the same focused tests plus `src/server/admin/product-registry-service.integration.test.ts` and expect PASS.

- [ ] **Step 6: Commit**

Commit: `feat: add versioned NZ and AU price books`

### Task 4: Add Admin AUD price-book editing and readiness controls

**Files:**
- Modify: `src/app/admin/products/page.tsx`
- Modify: `src/app/admin/products/page.test.tsx`
- Modify: `src/components/admin/product-registry-form.tsx`
- Modify: `src/components/admin/product-registry-form.test.tsx`
- Modify: `src/app/api/admin/products/[productKey]/route-handler.ts`
- Modify: `src/app/api/admin/products/[productKey]/route.test.ts`
- Modify: `src/app/api/admin/products/pricing-policy/route-handler.ts`
- Modify: `src/app/api/admin/products/pricing-policy/route.test.ts`

**Interfaces:**
- Separate `New Zealand — NZD` and `Australia — AUD` form sections.
- Nullable AUD draft fields, AU GST registration/rate, fixed AU shipping methods and audited enable control.
- Server-returned completeness list; client never decides checkout readiness.

- [ ] **Step 1: Write failing Admin tests**

Assert currency-labelled inputs, saving incomplete AU drafts while disabled, inability to enable incomplete AU, editing GST settings without changing gross prices, revision conflicts, and successful complete-market enable payload validation.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- \
  src/components/admin/product-registry-form.test.tsx \
  src/app/admin/products/page.test.tsx \
  'src/app/api/admin/products/[productKey]/route.test.ts' \
  src/app/api/admin/products/pricing-policy/route.test.ts
```

- [ ] **Step 3: Implement the forms and route parsing**

Reuse current UI, mutation service and validation errors. Do not add another Admin subsystem. Display final-price tax treatment and missing-key status plainly.

- [ ] **Step 4: Verify GREEN and commit**

Run the same tests and expect PASS.

Commit: `feat: manage AUD price books from Admin`

### Task 5: Build the authoritative market quote

**Files:**
- Create: `src/domain/pricing/market-quote.ts`
- Create: `src/domain/pricing/market-quote.test.ts`
- Modify: `src/domain/pricing/types.ts`
- Modify: `src/domain/configuration/quote.ts`
- Modify: `src/domain/configuration/quote.test.ts`
- Modify: `src/domain/checkout/types.ts`
- Modify: `src/domain/checkout/reprice-cart.ts`
- Modify: `src/domain/checkout/reprice-cart.test.ts`

**Interfaces:**
- Quote inputs include `market` and `priceBookRevision`.
- Quote output includes market, currency, tax jurisdiction/rate, gross/net/tax lines and total, plus explicit zero discount/design surcharge when inactive.
- Cart digest includes market, currency and registry revision.

- [ ] **Step 1: Write failing quote tests**

Use deliberately unrelated NZD and AUD fixtures. Assert size, people/pets, extra-photo, background-removal and urgent prices come only from the selected book. Assert AU unregistered and registered quotes have the same gross total, and missing AUD entries throw a typed readiness error.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/domain/pricing/market-quote.test.ts src/domain/configuration/quote.test.ts src/domain/checkout/reprice-cart.test.ts`

- [ ] **Step 3: Implement and replace authoritative repricing**

Retain legacy field aliases only where needed to read historical snapshots; new quotes use generic tax metadata. Do not allow fallback from AU to NZ. Freeze and safe-integer-check every line and total.

- [ ] **Step 4: Verify GREEN and commit**

Run the same tests and expect PASS.

Commit: `feat: reprice configurations by market`

### Task 6: Add market selection, cookie persistence and visible selector

**Files:**
- Create: `src/server/markets/market-cookie.ts`
- Create: `src/server/markets/market-cookie.test.ts`
- Create: `src/app/api/market/route-handler.ts`
- Create: `src/app/api/market/route.ts`
- Create: `src/app/api/market/route.test.ts`
- Create: `src/components/market-selector.tsx`
- Create: `src/components/market-selector.test.tsx`
- Modify: `src/components/site-header.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/components/storefront.module.css`

**Interfaces:**
- Cookie value is only `NZ` or `AU`; explicit AU routes override it.
- Selector displays `New Zealand — NZD` and `Australia — AUD`.
- Disabled AU remains visibly unavailable and cannot be selected into a purchasable state.

- [ ] **Step 1: Write failing cookie and UI tests**

Cover valid/invalid cookie parsing, secure attributes, explicit-route precedence, no PII, selector labels, keyboard access and disabled-AU behavior.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/server/markets/market-cookie.test.ts src/app/api/market/route.test.ts src/components/market-selector.test.tsx`

- [ ] **Step 3: Implement minimal selection flow**

POST the requested market to the same-origin route, set the safe cookie, clear stale market quote/recovery state through existing browser events, and navigate to the equivalent canonical route. Do not use IP as an authority.

- [ ] **Step 4: Verify GREEN and commit**

Run the same tests and expect PASS.

Commit: `feat: persist explicit storefront market selection`

### Task 7: Add stable AU routes and market-aware public pricing

**Files:**
- Create: `src/app/au/page.tsx`
- Create: `src/app/au/products/[slug]/page.tsx`
- Create: `src/app/au/products/[slug]/configure/page.tsx`
- Create: `src/app/au/products/[slug]/page.test.tsx`
- Create: `src/app/au/products/[slug]/configure/page.test.tsx`
- Modify: `src/app/products/[slug]/page-content.tsx`
- Modify: `src/app/products/[slug]/page.test.tsx`
- Modify: `src/app/products/[slug]/configure/page-content.tsx`
- Modify: `src/components/product-card.tsx`
- Modify: `src/components/product-card.test.tsx`
- Modify: `src/components/product-configurator.tsx`
- Modify: `src/components/product-configurator.test.tsx`
- Modify: `src/components/ad-landing-page.tsx`
- Modify: `src/components/ad-landing-page.test.tsx`

**Interfaces:**
- Reusable page content accepts an explicit market quote rather than deriving NZ GST locally.
- Disabled AU routes render a clear unavailable state, `noindex, nofollow`, stable URL and no checkout CTA.
- Enabled fixtures render `A$… AUD` and preserve AU route context through configure links.

- [ ] **Step 1: Write failing route/render tests**

Assert independent NZ/AU amount and currency, AU canonical path, disabled-AU robots, no NZ price fallback, and correct `/au/products/.../configure` links.

- [ ] **Step 2: Verify RED**

Run the listed route and component tests.

- [ ] **Step 3: Reuse existing storefront components with explicit market props**

Do not copy product business logic. Remove component-local `addNzdGst` from market-aware surfaces and pass the authoritative quote projection from server routes.

- [ ] **Step 4: Verify GREEN and commit**

Commit: `feat: add disabled AU storefront routes`

### Task 8: Preserve identity isolation while invalidating stale market state

**Files:**
- Modify: `src/domain/cart/types.ts`
- Modify: `src/domain/cart/cart.ts`
- Modify: `src/domain/cart/cart.test.ts`
- Modify: `src/domain/cart/browser-cart-repository.ts`
- Modify: `src/domain/cart/browser-cart-events.ts`
- Modify: `src/domain/cart/browser-cart-scope.test.ts`
- Modify: `src/components/pending-checkout.ts`
- Modify: `src/components/pending-checkout.test.ts`
- Modify: `src/components/cart-view.tsx`
- Modify: `src/components/cart-view.test.tsx`

**Interfaces:**
- Structural cart ownership remains identity scoped.
- Last-quote market/revision is informational and invalidated on market change.
- Pending checkout and payment recovery are cleared or revalidated before use in another market.

- [ ] **Step 1: Write failing same-browser identity/market tests**

Cover Guest NZ→AU, User A NZ→AU, A sign-out→Guest, Guest→B, and B→A. Assert no identity merge, no stale previous-market total, and preserved structural cart only for the same identity.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/domain/cart/cart.test.ts src/domain/cart/browser-cart-scope.test.ts src/components/pending-checkout.test.ts src/components/cart-view.test.tsx`

- [ ] **Step 3: Implement invalidation without changing identity namespaces**

Keep existing scoped storage keys. Add market/revision to quote metadata and clear in-memory quote, checkout draft, shipping selection and payment recovery when market changes.

- [ ] **Step 4: Verify GREEN and commit**

Commit: `fix: isolate cart identity while switching markets`

### Task 9: Make checkout country authoritative and add fixed AU shipping

**Files:**
- Modify: `src/domain/checkout/input-schema.ts`
- Modify: `src/server/checkout/checkout-service.ts`
- Modify: `src/server/checkout/checkout-service.test.ts`
- Modify: `src/server/checkout/checkout-repository.ts`
- Modify: `src/server/checkout/drizzle-checkout-repository.ts`
- Modify: `src/server/checkout/drizzle-checkout-repository.test.ts`
- Modify: `src/server/shipping/types.ts`
- Modify: `src/server/shipping/shipping-service.ts`
- Modify: `src/server/shipping/shipping-service.test.ts`
- Create: `src/server/shipping/fixed-market-provider.ts`
- Create: `src/server/shipping/fixed-market-provider.test.ts`
- Modify: `src/components/checkout-view.tsx`
- Modify: `src/components/checkout-view.test.tsx`
- Modify: `src/components/checkout-order-summary.tsx`
- Modify: `src/components/checkout-order-summary.test.tsx`

**Interfaces:**
- Destination `NZ` selects NZ/NZD; destination `AU` selects AU/AUD.
- Country change reprices cart from active registry revision and clears the old shipping quote before a new quote is selected.
- NZ uses GoSweetSpot/local test provider; AU uses fixed Admin AUD shipping entries.

- [ ] **Step 1: Write failing country-change and shipping tests**

Assert all product/option totals change, old quote ID is invalidated, AU never receives an NZD carrier quote, fixed AU shipping tax follows AU GST settings, and disabled/incomplete AU fails before order creation.

- [ ] **Step 2: Verify RED**

Run the listed checkout/shipping tests.

- [ ] **Step 3: Implement server-authoritative repricing**

Ignore browser market/currency/totals. Resolve from normalized delivery address, load one active registry revision, quote products and shipping in the same market, and include market/revision in the digest.

- [ ] **Step 4: Verify GREEN and commit**

Commit: `feat: reprice checkout from shipping destination`

### Task 10: Persist immutable order pricing snapshots and widen database currencies

**Files:**
- Create: `src/domain/orders/pricing-snapshot.ts`
- Create: `src/domain/orders/pricing-snapshot.test.ts`
- Modify: `src/server/db/schema/checkout.ts`
- Modify: `src/server/db/schema/orders.ts`
- Modify: `src/server/db/schema/payments.ts`
- Modify: `src/server/db/schema/checkout-schema.test.ts`
- Modify: `src/server/db/schema/checkout-schema.integration.test.ts`
- Modify: `src/server/orders/order-repository.ts`
- Modify: `src/server/orders/drizzle-order-repository.ts`
- Modify: `src/server/orders/drizzle-order-repository.test.ts`
- Modify: `src/server/orders/drizzle-order-repository.integration.test.ts`
- Modify: `src/server/orders/order-service.ts`
- Modify: `src/server/orders/order-service.test.ts`
- Generate: `drizzle/0023_*.sql`
- Generate: `drizzle/meta/0023_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

**Interfaces:**
- Orders and shipping/payment attempts allow only `NZD` or `AUD` for web orders.
- Order snapshot stores market, currency, price-book revision, per-unit/option lines, jurisdiction/rate/tax, shipping, discount and final total.
- Existing rows receive safe NZ defaults without recomputing stored totals.

- [ ] **Step 1: Write failing schema/repository tests**

Assert old NZ rows remain valid, AUD rows balance, order snapshot equals the checkout quote at creation, later registry changes do not affect it, and currency/market/tax mismatch is rejected.

- [ ] **Step 2: Verify RED**

Run the listed schema, order and repository tests.

- [ ] **Step 3: Implement schema and repository changes**

Add backward-safe defaults and constraints. Store a typed JSONB pricing snapshot plus explicit searchable market/currency/revision/tax fields where appropriate. Keep current legacy amount columns readable for invoices and operations.

- [ ] **Step 4: Generate and inspect migration**

Run: `npm run db:generate && npm run db:check`

Inspect the generated SQL to ensure it does not recalculate or delete existing orders/payments and that constraints are replaced in a safe order.

- [ ] **Step 5: Verify GREEN and commit**

Commit: `feat: snapshot market pricing on orders`

### Task 11: Derive payment currency from the stored order

**Files:**
- Modify: `src/server/payments/payment-repository.ts`
- Modify: `src/server/payments/drizzle-payment-repository.ts`
- Modify: `src/server/payments/drizzle-payment-repository.test.ts`
- Modify: `src/server/payments/payment-service.ts`
- Modify: `src/server/payments/payment-service.test.ts`
- Modify: `src/server/payments/stripe-provider.test.ts`
- Modify: `src/components/stripe-payment-form.tsx`
- Modify: `src/components/stripe-payment-form.test.tsx`

**Interfaces:**
- `CreatePaymentAttemptInput.currency` is the stored order currency, not hard-coded NZD.
- Stripe receives lowercase `nzd` or `aud` from the verified order snapshot.
- Payment UI formats the order's explicit currency.

- [ ] **Step 1: Write failing AUD payment tests**

Assert an AUD order creates an AUD attempt and Stripe PaymentIntent with `currency: "aud"`; an NZ order remains `nzd`; browser-supplied currency and amount cannot override either.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/server/payments/payment-service.test.ts src/server/payments/drizzle-payment-repository.test.ts src/server/payments/stripe-provider.test.ts src/components/stripe-payment-form.test.tsx`

- [ ] **Step 3: Remove NZD payment hard-codes and verify**

Use `order.currency` throughout attempt creation and UI. Keep provider amount/currency verification unchanged.

- [ ] **Step 4: Verify GREEN and commit**

Commit: `feat: charge Stripe in stored order currency`

### Task 12: Align SEO, structured data, feeds and analytics currency

**Files:**
- Modify: `src/app/sitemap.ts`
- Modify: `src/app/robots.ts`
- Modify: `src/app/layout.test.ts`
- Modify: `src/app/products/[slug]/page-content.tsx`
- Modify: `src/components/ad-landing-page.tsx`
- Modify: `src/domain/analytics/events.ts`
- Modify: `src/domain/analytics/events.test.ts`
- Modify: `src/server/seo/metadata.ts`
- Create or modify the existing Merchant-compatible product projection and its test, located by `rg -n "Merchant|priceCurrency|Offer" src` before editing.

**Interfaces:**
- Product/Offer, landing page, Merchant-compatible records, analytics and checkout consume the same quote amount/currency.
- Disabled AU pages remain noindex and absent from sitemap/feed.
- Purchase currency comes from the real stored order.

- [ ] **Step 1: Write failing consistency tests**

Use one fixture per market and assert identical amount/currency across rendered price, JSON-LD, Merchant projection, checkout quote and purchase event. Assert disabled AU URLs are not in sitemap and have noindex.

- [ ] **Step 2: Verify RED**

Run the focused SEO, landing, product-page and analytics tests.

- [ ] **Step 3: Replace NZD hard-codes only in market-aware commerce paths**

Do not alter unrelated legacy production-form or invoice currency behavior unless it displays a new AU web order, in which case format from the stored order currency.

- [ ] **Step 4: Verify GREEN and commit**

Commit: `feat: align market prices across SEO and analytics`

### Task 13: Full regression, browser tests and readiness report

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `playwright.config.ts`
- Create: `e2e/market-pricing.spec.ts`
- Modify: `docs/google-ads-readiness-code.md`
- Modify only source/tests required by observed failures.

- [ ] **Step 1: Add same-browser Playwright coverage**

Add `@playwright/test` as a direct development dependency and an explicit `test:e2e:market` script. Use isolated test fixtures and mocked payment-provider boundaries; do not write fictional AUD values into the production registry.

Cover desktop and 390px flows for:

- NZ product/configure/cart/checkout amount consistency;
- visible country selector;
- disabled AU direct routes and no checkout action;
- test fixture with complete enabled AU price book showing unrelated fixed AUD amounts;
- destination NZ→AU full reprice and shipping invalidation;
- Guest→A→sign out→B→sign out→A identity isolation across market changes;
- AU missing-price refusal;
- order snapshot and Stripe mock `aud`/`nzd` assertions.

- [ ] **Step 2: Run focused full-domain regression**

Run:

```bash
npm test -- \
  src/domain/catalogue \
  src/domain/pricing \
  src/domain/configuration \
  src/domain/cart \
  src/domain/checkout \
  src/server/admin/product-registry-service.test.ts \
  src/server/checkout \
  src/server/shipping \
  src/server/orders \
  src/server/payments
```

Expected: PASS.

- [ ] **Step 3: Run complete verification**

Run:

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run db:check
npm run build
```

Expected: all exit 0.

- [ ] **Step 4: Run real browser checks on the canonical local site**

Run: `npm run test:e2e:market`

Configure Playwright to use `http://192.168.4.199:3000` only. Verify desktop and 390px screenshots, selector accessibility, disabled AU state, NZ unchanged prices and checkout, and enabled-AU test-fixture behavior without real payment.

- [ ] **Step 5: Update readiness documentation**

Record AU dual-market code as completed but disabled. List the entire confirmed AUD commercial price book, AU shipping values, AU tax registration decision, AU provider-account verification, Merchant/Ads publishing and real AU payment as remaining external/business gates.

- [ ] **Step 6: Final implementation commit**

Commit: `test: verify NZ and AU market isolation`

## Production gate

Do not deploy automatically as part of this plan. Before any later production deployment, compare the exact production commit/tree against the tested commit, run the migration preflight, take a database backup, deploy with AU disabled, smoke-test current NZ checkout and payment start, and verify `/au` remains noindex and non-purchasable. Public AU enablement requires a separate explicit approval after every AUD price and operational dependency is confirmed.
