# Country / Market Detection & Switching Implementation Plan

> **For Codex:** Execute each task in order with test-driven development. Do not generate or run migrations. Production release must flow through `origin/main` and Vercel Git integration only.

**Goal:** Resolve NZ/AU before first render, persist explicit customer choices, keep storefront/cart/checkout consistent, and make delivery country authoritative at checkout.

**Architecture:** Extend the existing `Market`, `rnr-market` cookie, market switch API, identity-scoped cart, checkout session, NZ GoSweetSpot flow, and AU fixed-rate flow. Add one server resolver consumed by Proxy and Server Components. Keep explicit `/au` routes request-local, preserve saved preferences, and reconcile cart/checkout through existing server-authoritative repricing.

**Tech Stack:** Next.js 16.3 App Router/Proxy, React 19, TypeScript, Vitest/Testing Library, existing Drizzle schema (unchanged).

---

## Task 1: Server market resolver and route mapping

**Files:**
- Create: `src/server/markets/request-market.ts`
- Modify: `src/server/markets/market-cookie.ts`
- Modify: `src/domain/markets/market.ts`
- Test: `src/server/markets/request-market.test.ts`
- Test: `src/server/markets/market-cookie.test.ts`
- Test: `src/domain/markets/market.test.ts`

1. Write failing tests for NZ/AU/other/missing country, saved preference priority, explicit AU URL intent, invalid values, crawler stability, and safe route mappings.
2. Run the focused tests and confirm RED.
3. Implement a pure request resolver and explicit route mapping helpers without side effects.
4. Run the focused tests and confirm GREEN.

## Task 2: Proxy geo detection and SSR market context

**Files:**
- Modify: `src/proxy.ts`
- Modify: `src/app/layout.tsx`
- Modify: `src/components/site-chrome.tsx`
- Test: `src/proxy.test.ts`
- Test: `src/app/layout.test.ts`
- Test: `src/components/site-chrome.test.tsx`

1. Write failing tests for the Vercel `x-vercel-ip-country` input, validated cookie priority, explicit AU URL behaviour, crawler no-redirect, internal header overwrite, query preservation, and no redirect loop.
2. Run tests and confirm RED.
3. Extend Proxy coverage only to relevant page requests while excluding API/static/media internals; preserve the existing admin request-path header.
4. Set an internal resolved-market header and perform only stable route redirects.
5. Read the resolved market in the root layout; remove the late AU client redirect while retaining explicit navigation transition state.
6. Run tests and confirm GREEN.

## Task 3: Accessible desktop/mobile selector and preference semantics

**Files:**
- Modify: `src/app/api/market/route-handler.ts`
- Modify: `src/components/market-selector.tsx`
- Modify: `src/components/site-header.tsx`
- Modify: `src/app/globals.css`
- Test: `src/app/api/market/route.test.ts`
- Test: `src/components/market-selector.test.tsx`
- Test: `src/components/site-shell.test.tsx`

1. Add failing tests for optional non-persistent automatic repricing and manual cookie persistence.
2. Add failing tests for a labelled selector inside mobile navigation and current market/accessibility state.
3. Implement a narrowly typed `persistPreference` request option; only explicit selection/checkout confirmation may persist.
4. Reuse the selector in mobile navigation with unique accessible labels and existing design tokens.
5. Run focused tests and confirm GREEN.

## Task 4: Cart market reconciliation

**Files:**
- Modify: `src/app/cart/page.tsx`
- Modify: `src/components/cart-view.tsx`
- Modify: `src/components/storefront.module.css` only if a status style is required
- Modify/Create shared browser helper only if it removes duplicated switch logic
- Test: `src/components/cart-view.test.tsx`
- Test: existing cart repository/scope/event tests

1. Write failing tests for NZ->AU and AU->NZ mismatches, hidden stale totals during reconciliation, authoritative replacement, active-identity-only cleanup, safe failure, and market-aware links.
2. Run focused tests and confirm RED.
3. Pass the server-resolved market into CartView.
4. Reprice mismatched non-empty carts through `/api/market` without saving an automatic preference, replace the active cart, invalidate stale checkout/recovery state, and notify subscribers.
5. Keep old cart/context untouched on failure and block checkout with a recoverable message.
6. Run focused tests and confirm GREEN.

## Task 5: Checkout delivery-country reconciliation

**Files:**
- Modify: `src/app/checkout/page.tsx`
- Modify: `src/components/checkout-view.tsx`
- Modify: `src/components/address-form.tsx` only if needed for country callbacks/labels
- Modify: relevant checkout CSS only for the mismatch notice
- Test: `src/components/checkout-view.test.tsx`
- Test: `src/components/address-form.test.tsx`
- Test: `src/server/checkout/checkout-service.test.ts`
- Test: `src/server/orders/order-service.test.ts`
- Test: checkout session/shipping/order route tests

1. Write failing UI tests for editable billing/delivery countries, billing-country independence, NZ<->AU delivery mismatch notice, blocked review/payment, confirmed authoritative repricing, address preservation, and stale shipping/payment invalidation.
2. Add/confirm server tests for delivery-country-derived market and fail-closed market/currency/shipping/total mismatches.
3. Run focused tests and confirm RED where behaviour is missing.
4. Remove the UI country lock, use delivery country as the market trigger, and provide explicit confirmation copy.
5. Reuse authoritative market repricing, persist the confirmed delivery market, update shared market UI, preserve entered addresses, and restart review from a clean shipping/payment state.
6. Keep server-side order validation authoritative and unchanged unless a concrete uncovered gap requires a minimal guard.
7. Run focused tests and confirm GREEN.

## Task 6: Route, SEO, and regression coverage

**Files:**
- Modify only existing metadata/sitemap tests if resolver behaviour requires coverage
- Test relevant Home/Shop/Product/Gallery/Cart/Checkout route suites

1. Add tests that canonical metadata and sitemap remain stable and crawlers are not geo-redirected.
2. Verify direct NZ/AU product URLs and shared Gallery/Design URLs.
3. Verify Admin, Forms, Order System, auth, payments, and legacy orders remain unaffected.

## Task 7: Full verification and browser QA

1. Confirm the target database for any DB-backed test is an isolated Test DB; stop if identity is uncertain.
2. Run focused market/cart/checkout suites.
3. Run `npm run typecheck`.
4. Run `npm run lint`.
5. Run `npm run db:check` (schema inspection only; no migration).
6. Run `npm test -- --run` using the isolated Test DB where required.
7. Run `npm run build` with the required non-Production deployment context accepted by the existing prebuild guard.
8. Run `git diff --check`.
9. Start an unused local port without stopping the canonical port 3000 and verify 390px, 768px, 1280px, and 1440px flows: first-load NZ/AU headers, desktop/mobile switching, route persistence, cart repricing, checkout mismatch copy, no flicker/overflow, and no broken core pages.
10. Stop the temporary service and remove only temporary test/browser artifacts.

## Task 8: Review, integration, and Production release

1. Inspect the complete diff for scope, security, pricing/shipping invariants, identity isolation, SEO, and accidental migration/schema changes.
2. Commit implementation on `feat/country-market-detection` and push the feature branch.
3. `git fetch origin --prune`; compare the feature branch with current `origin/main`; stop on unexpected overlap/drift.
4. Use a clean release worktree to fast-forward or perform the approved normal merge into `main`; never force-push.
5. Push `main` and let Vercel Git integration create the Production deployment. Do not run `vercel --prod`.
6. Verify Vercel Production Branch is `main`, deployment is READY, deployment SHA equals `origin/main`, `githubCommitRef=main`, and both Production aliases are present.
7. Run only non-mutating Production smoke checks for NZ/AU Home, Shop, Product, Gallery, Cart, Checkout load, selectors, HTTPS, canonical, Forms/Order System/Admin access boundaries, and existing payments UI load.
8. Report exact commit/deployment evidence and known-good rollback artifact. Do not migrate Production.
