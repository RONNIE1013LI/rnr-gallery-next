# Consumer GST Price Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every consumer-facing price lead with the actual NZD amount payable including GST while preserving every catalogue, tax, order, shipping, Stripe, and Afterpay calculation.

**Architecture:** Keep the current mixed-tax price model authoritative. Add one pure display helper that returns a price line's inclusive amount without taxing already-inclusive fees, then use it in consumer summaries. Remove secondary excluded-GST prices from public acquisition and product-selection surfaces; retain tax components only as subordinate “Includes GST” details.

**Tech Stack:** Next.js App Router, React, TypeScript, Vitest, Testing Library, Playwright.

## Global Constraints

- Roll-Up Banner remains NZ$230.00 excluding GST, NZ$34.50 GST, and NZ$264.50 including GST.
- Product sizes, people/pet fees, and extra-photo fees receive GST exactly once.
- Urgent-service and background-removal fees are already GST-inclusive and must not be taxed again.
- Existing orders, completed payments, Stripe/Afterpay calculations, shipping-provider calculations, admin storage, and database fields do not change.
- Consumer prices use explicit `NZ$` and make the GST-inclusive payable amount primary.

---

### Task 1: Mixed-tax display helper

**Files:**
- Modify: `src/domain/pricing/types.ts`
- Test: `src/domain/pricing/pricing.test.ts`

**Interfaces:**
- Consumes: `PriceLine` with `amountExGstCents` and optional `amountInclGstCents`.
- Produces: `getPriceLineAmountInclGstCents(line: PriceLine): number`.

- [ ] **Step 1: Write failing tests**

Add assertions that an excluded-GST line of 23,000 cents displays as 26,450 cents and an already-included urgent fee of 8,000 cents remains 8,000 cents.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/domain/pricing/pricing.test.ts`
Expected: FAIL because `getPriceLineAmountInclGstCents` is not exported.

- [ ] **Step 3: Implement the helper**

Return `amountInclGstCents` when present; otherwise validate `amountExGstCents` and calculate `Math.round(amountExGstCents * 115 / 100)`.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- src/domain/pricing/pricing.test.ts`
Expected: PASS.

### Task 2: Public product and advertising prices

**Files:**
- Modify: `src/components/product-card.tsx`
- Modify: `src/app/products/[slug]/page-content.tsx`
- Modify: `src/app/designs/[slug]/page.tsx`
- Modify: `src/components/ad-landing-page.tsx`
- Test: `src/components/product-card.test.tsx`
- Test: `src/app/products/[slug]/page.test.tsx`
- Test: `src/app/designs/[slug]/page.test.tsx`
- Test: `src/components/ad-landing-page.test.tsx`

**Interfaces:**
- Consumes: the existing `addNzdGst` and `formatNzd` utilities.
- Produces: one visible `From NZ$… incl GST` price with no secondary `excl GST` price.

- [ ] **Step 1: Write failing assertions**

Assert the inclusive starting price is visible and the corresponding `excl GST` text is absent on each representative surface.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/components/product-card.test.tsx src/app/products/[slug]/page.test.tsx src/app/designs/[slug]/page.test.tsx src/components/ad-landing-page.test.tsx`
Expected: FAIL because the secondary excluded-GST prices are still rendered.

- [ ] **Step 3: Remove only secondary excluded-GST markup**

Keep the inclusive calculation, structured-data price, links, and layout unchanged.

- [ ] **Step 4: Verify GREEN**

Run the same four test files and expect PASS.

### Task 3: Configurator and order price summaries

**Files:**
- Modify: `src/components/product-configurator.tsx`
- Modify: `src/components/cart-view.tsx`
- Modify: `src/components/checkout-entry-summary.tsx`
- Modify: `src/components/checkout-order-summary.tsx`
- Modify: `src/components/order-detail.tsx`
- Test: `src/components/product-configurator.test.tsx`
- Test: `src/components/cart-view.test.tsx`
- Test: `src/components/checkout-order-summary.test.tsx`
- Test: `src/app/orders/order-pages.test.tsx`

**Interfaces:**
- Consumes: `getPriceLineAmountInclGstCents` and existing authoritative `totalInclGstCents` fields.
- Produces: inclusive item lines, `Products/Shipping/Subtotal incl GST`, subordinate `Includes GST`, and unchanged final totals.

- [ ] **Step 1: Write failing summary tests**

Assert the Roll-Up Banner size choice and price line show NZ$264.50 incl GST, urgent service remains its configured inclusive amount, summaries label product/shipping/subtotals as inclusive, and legacy `excl GST` customer-facing labels are absent.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/components/product-configurator.test.tsx src/components/cart-view.test.tsx src/components/checkout-order-summary.test.tsx src/app/orders/order-pages.test.tsx`
Expected: FAIL on current excluded-GST line labels and amounts.

- [ ] **Step 3: Implement inclusive presentation**

Use authoritative inclusive totals for all customer-facing amounts. Use the mixed-tax display helper for individual price lines. Keep GST as an “Includes GST” disclosure and do not alter quote, cart, order, or payment arithmetic.

- [ ] **Step 4: Verify GREEN**

Run the same four test files and expect PASS.

### Task 4: Full regression and browser verification

**Files:**
- Modify only tests if a verified regression exposes an incorrect expectation.

**Interfaces:**
- Consumes: completed Tasks 1–3.
- Produces: evidence that display changed while money calculations did not.

- [ ] **Step 1: Run focused tax and payment regression**

Run: `npm test -- src/domain/pricing/pricing.test.ts src/domain/configuration/quote.test.ts src/domain/checkout/reprice-cart.test.ts src/server/orders/order-service.test.ts src/server/payments/drizzle-payment-repository.test.ts`
Expected: PASS with Roll-Up Banner total 26,450 cents and included fees unchanged.

- [ ] **Step 2: Run static and production checks**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all exit 0.

- [ ] **Step 3: Verify canonical local site**

At `http://192.168.4.199:3000`, verify Shop, Roll-Up Banner configuration, Cart, and Checkout at desktop and 390px mobile. The product must show NZ$264.50 incl GST, and the checkout/payment total must remain the same.

- [ ] **Step 4: Commit implementation**

Stage only the files listed in Tasks 1–3 plus this plan, then commit with `fix: unify GST-inclusive consumer price display`.

