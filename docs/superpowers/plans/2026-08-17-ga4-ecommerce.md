# GA4 Ecommerce Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load GA4 Measurement ID `G-RE5Z5B58TJ` only on Vercel Production and emit eight privacy-safe NZD/AUD ecommerce events from real storefront actions.

**Architecture:** The root App Router layout owns the single official `GoogleAnalytics` component and exposes a server-decided DOM enable flag. Pure typed builders create allowlisted event payloads from product, cart, repriced checkout, and immutable paid-order snapshots; a client-only transport calls official `sendGAEvent`. UI components emit only after the corresponding business action succeeds, while render-driven events use component-local fingerprints and purchases retain transaction-level session deduplication.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript, `@next/third-parties/google` 16.3.0, Vitest, Testing Library, Vercel Production, GA4 Realtime and DebugView.

## Global Constraints

- Measurement ID is exactly `G-RE5Z5B58TJ`.
- Render one official `GoogleAnalytics` component from the root layout only.
- Enable collection only when `process.env.VERCEL_ENV === "production"`.
- Local, test, Vercel Preview, and staging must not load or emit to the production GA4 property.
- Do not install Google Tag Manager or a manual `gtag.js` script.
- Emit `view_item`, `add_to_cart`, `remove_from_cart`, `view_cart`, `begin_checkout`, `add_shipping_info`, `add_payment_info`, and `purchase`.
- Use authoritative `NZD` or `AUD`; never perform live currency conversion.
- `purchase.value` excludes separately reported tax and shipping.
- Never send customer identity/contact/address data, artwork wording, notes, upload names, upload references, image URLs, private tokens, or payment-provider references.
- Do not change product prices, tax, shipping, cart identity, checkout, payment, or order business rules.
- Do not deploy Banner Bundle or migration `0029_banner_bundle_components` as part of the GA4 release.
- Production release base is Vercel deployment `AFyg5GgL5Dx9TbhbJAJB1y6oq6Dp`, Git revision `687899e6e2775639db72f6a3f70616d1f1c38e1e`.

## File map

- `package.json`, `package-lock.json`: add the official package at `16.3.0`.
- `src/domain/analytics/runtime.ts`: production predicate, measurement ID, and debug-session key.
- `src/domain/analytics/runtime.test.ts`: production/preview/local enablement contract.
- `src/domain/analytics/events.ts`: pure event types and allowlisted product/cart/checkout/order builders.
- `src/domain/analytics/events.test.ts`: event money, currency, paid-order, and privacy tests.
- `src/domain/analytics/client.ts`: client-only `sendGAEvent` transport and controlled session debug flag.
- `src/domain/analytics/client.test.ts`: disabled no-op, official call shape, and debug-mode tests.
- `src/components/analytics-event-tracker.tsx`: component-local fingerprint deduplication for render-driven events.
- `src/components/analytics-event-tracker.test.tsx`: rerender and identity-scope tests.
- `src/app/layout.tsx`, `src/app/layout.test.ts`: one production-only root installation and duplicate-tag audit.
- `src/app/products/[slug]/page-content.tsx`, `src/app/products/[slug]/page.test.tsx`: NZ product `view_item` payload.
- `src/app/au/products/[slug]/page.tsx`, `src/app/au/products/[slug]/page.test.tsx`: AU product `view_item` payload.
- `src/components/product-configurator.tsx`, `src/components/product-configurator.test.tsx`: standard product `add_to_cart`.
- `src/components/banner-bundle-configurator.tsx`, `src/components/banner-bundle-configurator.test.tsx`: Bundle `add_to_cart` without customisation leakage.
- `src/components/cart-view.tsx`, `src/components/cart-view.test.tsx`: `view_cart` and `remove_from_cart`.
- `src/components/checkout-view.tsx`, `src/components/checkout-view.test.tsx`: `begin_checkout`, `add_shipping_info`, and external-provider `add_payment_info`.
- `src/components/stripe-payment-form.tsx`, `src/components/stripe-payment-form.test.tsx`: card/wallet `add_payment_info` callback at actual submission.
- `src/components/purchase-tracker.tsx`, `src/components/purchase-tracker.test.tsx`: official transport plus stable purchase deduplication.

---

### Task 1: Isolate GA4 from the Current Development Branch

**Files:**
- Preserve: all existing untracked files in `.worktrees/payment-adapters`
- Create worktree: `/Users/ronnieli/Documents/海报制作/rnr-next-platform/.worktrees/ga4-ecommerce`

**Interfaces:**
- Consumes: Vercel production Git revision `687899e6e2775639db72f6a3f70616d1f1c38e1e`.
- Produces: clean branch `feat/ga4-ecommerce` whose first parent is the exact deployed revision.

- [ ] **Step 1: Read the worktree skill and recheck the release base**

Run:

```bash
git show -s --format='%H %s' 687899e6e2775639db72f6a3f70616d1f1c38e1e
git status --short
git worktree list
```

Expected: the revision is `fix: keep guest checkout note on one line`; the existing unrelated untracked files remain only in `payment-adapters`.

- [ ] **Step 2: Create the isolated worktree from the deployed revision**

Run:

```bash
git worktree add /Users/ronnieli/Documents/海报制作/rnr-next-platform/.worktrees/ga4-ecommerce -b feat/ga4-ecommerce 687899e6e2775639db72f6a3f70616d1f1c38e1e
```

Expected: new clean worktree at the exact production revision.

- [ ] **Step 3: Bring the approved design into the isolated branch**

Run in the new worktree:

```bash
git cherry-pick e982ae1
```

Expected: only `docs/superpowers/specs/2026-08-17-ga4-ecommerce-design.md` is added.

- [ ] **Step 4: Record the implementation baseline**

Run:

```bash
git status --short
npm test -- --run src/domain/analytics/events.test.ts src/components/purchase-tracker.test.tsx src/app/layout.test.ts
```

Expected: clean status and the existing focused baseline passes before GA4 code changes.

---

### Task 2: Install the Official Production-Only Root Tag

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/domain/analytics/runtime.ts`
- Create: `src/domain/analytics/runtime.test.ts`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/layout.test.ts`

**Interfaces:**
- Produces: `GA4_MEASUREMENT_ID`, `GA4_DEBUG_SESSION_KEY`, and `isGa4Production(vercelEnv: string | undefined): boolean`.
- Produces: `<html data-ga4-enabled="true">` and one `<GoogleAnalytics gaId="G-RE5Z5B58TJ" />` only in Vercel Production.

- [ ] **Step 1: Write failing runtime and installation tests**

Add this contract to `runtime.test.ts`:

```ts
expect(isGa4Production("production")).toBe(true);
expect(isGa4Production("preview")).toBe(false);
expect(isGa4Production("development")).toBe(false);
expect(isGa4Production(undefined)).toBe(false);
expect(GA4_MEASUREMENT_ID).toBe("G-RE5Z5B58TJ");
```

Extend `layout.test.ts` to read `src/app/layout.tsx` and assert exactly one `GoogleAnalytics`, no `GoogleTagManager`, no `googletagmanager.com`, and use of `isGa4Production(process.env.VERCEL_ENV)`.

- [ ] **Step 2: Run the tests and confirm RED**

Run:

```bash
npm test -- --run src/domain/analytics/runtime.test.ts src/app/layout.test.ts
```

Expected: FAIL because the runtime module and official root component do not exist.

- [ ] **Step 3: Install the package and implement the runtime boundary**

Run:

```bash
npm install @next/third-parties@16.3.0 --save-exact
```

Implement `runtime.ts`:

```ts
export const GA4_MEASUREMENT_ID = "G-RE5Z5B58TJ";
export const GA4_DEBUG_SESSION_KEY = "rnr:analytics:v1:debug";

export function isGa4Production(vercelEnv: string | undefined): boolean {
  return vercelEnv === "production";
}
```

In `RootLayout`, calculate `const ga4Enabled = isGa4Production(process.env.VERCEL_ENV)`, set `data-ga4-enabled={ga4Enabled ? "true" : undefined}` on `<html>`, and render `{ga4Enabled ? <GoogleAnalytics gaId={GA4_MEASUREMENT_ID} /> : null}` once after `</body>`.

- [ ] **Step 4: Run focused tests and build-time type checking**

Run:

```bash
npm test -- --run src/domain/analytics/runtime.test.ts src/app/layout.test.ts
npm run typecheck
```

Expected: PASS; no component or client emission is enabled for any non-production Vercel environment.

- [ ] **Step 5: Commit the root integration**

Run:

```bash
git add package.json package-lock.json src/domain/analytics/runtime.ts src/domain/analytics/runtime.test.ts src/app/layout.tsx src/app/layout.test.ts
git commit -m "feat: load GA4 only in production"
```

---

### Task 3: Build the Typed Privacy-Safe GA4 Event Layer

**Files:**
- Modify: `src/domain/analytics/events.ts`
- Modify: `src/domain/analytics/events.test.ts`
- Create: `src/domain/analytics/client.ts`
- Create: `src/domain/analytics/client.test.ts`
- Create: `src/components/analytics-event-tracker.tsx`
- Create: `src/components/analytics-event-tracker.test.tsx`
- Modify: `src/components/purchase-tracker.tsx`
- Modify: `src/components/purchase-tracker.test.tsx`

**Interfaces:**
- Produces: `buildProductViewEvent(input: ProductViewAnalyticsInput): CommerceEvent`, `buildCartItemEvent(name: "add_to_cart" | "remove_from_cart", item: CartItem): CommerceEvent`, `buildCartEvent(name: "view_cart" | "begin_checkout", cart: Cart): CommerceEvent | null`, `buildCheckoutEvent(name: "add_shipping_info" | "add_payment_info", cart: RepricedCheckoutCart, details: CheckoutAnalyticsDetails): CommerceEvent`, and corrected `buildPurchaseEvent(order: PublicOrder): PurchaseEvent | null`.
- Produces: `emitAnalyticsEvent(event: AnalyticsEvent | null): boolean` in the client-only module.
- Produces: `<AnalyticsEventTracker event={event} scopeKey={string} />`, accepting `AnalyticsEvent | null`, for rerender-safe page events.

- [ ] **Step 1: Expand the failing pure-builder tests**

Add assertions for all event names and exact allowlisted payloads:

```ts
expect(buildCartEvent("view_cart", nzdCart)).toEqual({
  event: "view_cart",
  currency: "NZD",
  value: 65,
  items: [{
    item_id: "photo-print-canvas",
    item_name: "Photo Print Canvas",
    item_variant: "a4",
    price: 65,
    quantity: 1,
  }],
});
expect(buildCheckoutEvent("add_shipping_info", audCheckout, {
  shipping_tier: "AU Standard",
})).toMatchObject({ event: "add_shipping_info", currency: "AUD" });
```

Update the paid-order expectation so `purchase.value` is `65`, `tax` remains `12.75`, `shipping` remains `23`, and item `price` is `65`. Assert `JSON.stringify(event)` excludes representative private names, emails, addresses, phone numbers, design text, upload references, image URLs, checkout tokens, and payment IDs.

- [ ] **Step 2: Add failing transport tests**

Mock `@next/third-parties/google` and assert:

```ts
expect(emitAnalyticsEvent(event)).toBe(false); // data attribute absent
document.documentElement.dataset.ga4Enabled = "true";
expect(emitAnalyticsEvent(event)).toBe(true);
expect(sendGAEvent).toHaveBeenCalledWith("event", "view_cart", {
  currency: "NZD",
  value: 65,
  items: expect.any(Array),
});
```

Navigate the test URL to `?ga_debug=1`, assert `debug_mode: true` is added and `GA4_DEBUG_SESSION_KEY` is stored only in `sessionStorage`. Assert `?ga_debug=0` clears it.

- [ ] **Step 3: Run the expanded tests and confirm RED**

Run:

```bash
npm test -- --run src/domain/analytics/events.test.ts src/domain/analytics/client.test.ts src/components/analytics-event-tracker.test.tsx src/components/purchase-tracker.test.tsx
```

Expected: FAIL because the builders, official transport, and tracker are not implemented.

- [ ] **Step 4: Implement pure builders with an explicit allowlist**

Use this event union:

```ts
type CommerceEventName =
  | "view_item"
  | "add_to_cart"
  | "remove_from_cart"
  | "view_cart"
  | "begin_checkout"
  | "add_shipping_info"
  | "add_payment_info";
```

Define the builder inputs explicitly:

```ts
export type ProductViewAnalyticsInput = Readonly<{
  productKey: string;
  productName: string;
  category?: string;
  sizeKey: string;
  currency: MarketCurrency;
  unitSubtotalExTaxCents: number;
}>;

export type CheckoutAnalyticsDetails = Readonly<{
  shipping_tier?: string;
  payment_type?: "card" | "afterpay" | "zip";
}>;
```

`AnalyticsItem` contains only `item_id`, `item_name`, optional public `item_category`, optional `item_variant`, numeric `price`, and `quantity`. Convert integer cents with `Number((cents / 100).toFixed(2))`. Cart items use `item.price.subtotalExGstCents`; repriced checkout items use `item.unitPrice.subtotalExGstCents`; paid-order items use `item.unitSubtotalExGstCents`. Return `null` for empty carts, mixed currencies, invalid/non-paid purchase input, or non-safe monetary values.

- [ ] **Step 5: Implement official client transport and local deduplication**

Create a `"use client"` module importing `sendGAEvent`. Check `document.documentElement.dataset.ga4Enabled === "true"`, strip `event` from the payload, add `debug_mode: true` only for the controlled debug session, then call:

```ts
sendGAEvent("event", event.event, payload);
```

`AnalyticsEventTracker` keeps the last `${scopeKey}:${JSON.stringify(event)}` in a `useRef`; it may emit again after unmount/revisit or when the identity scope/event changes, but not on a React rerender.

- [ ] **Step 6: Migrate purchase tracking to the official transport**

Import `emitAnalyticsEvent` from `src/domain/analytics/client.ts`. Keep the existing transaction-specific session key `rnr:analytics:v1:purchase:<transaction_id>` and set it only after the official transport returns `true`.

- [ ] **Step 7: Run the focused tests and type checker**

Run:

```bash
npm test -- --run src/domain/analytics/events.test.ts src/domain/analytics/client.test.ts src/components/analytics-event-tracker.test.tsx src/components/purchase-tracker.test.tsx
npm run typecheck
```

Expected: PASS for all eight event shapes, production no-op behavior, debug mode, privacy assertions, and purchase deduplication.

- [ ] **Step 8: Commit the event layer**

Run:

```bash
git add src/domain/analytics/events.ts src/domain/analytics/events.test.ts src/domain/analytics/client.ts src/domain/analytics/client.test.ts src/components/analytics-event-tracker.tsx src/components/analytics-event-tracker.test.tsx src/components/purchase-tracker.tsx src/components/purchase-tracker.test.tsx
git commit -m "feat: add privacy-safe GA4 ecommerce events"
```

---

### Task 4: Instrument Product and Cart Actions

**Files:**
- Modify: `src/app/products/[slug]/page-content.tsx`
- Modify: `src/app/products/[slug]/page.test.tsx`
- Modify: `src/app/au/products/[slug]/page.tsx`
- Modify: `src/app/au/products/[slug]/page.test.tsx`
- Modify: `src/components/product-configurator.tsx`
- Modify: `src/components/product-configurator.test.tsx`
- Modify: `src/components/banner-bundle-configurator.tsx`
- Modify: `src/components/banner-bundle-configurator.test.tsx`
- Modify: `src/components/cart-view.tsx`
- Modify: `src/components/cart-view.test.tsx`

**Interfaces:**
- Consumes: builders and client transport from Task 3.
- Produces: real `view_item`, `add_to_cart`, `view_cart`, and `remove_from_cart` emissions.

- [ ] **Step 1: Write failing product-view tests for both currencies**

Mock the tracker and assert the NZ route provides `currency: "NZD"` with the selected/default quote subtotal excluding tax, while the AU route provides `currency: "AUD"` from the fixed AU price book. Assert no live conversion and no selected-design title/image URL enters the event.

- [ ] **Step 2: Write failing add/remove/view cart tests**

Mock `emitAnalyticsEvent` and assert:

```ts
fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));
expect(emitAnalyticsEvent).toHaveBeenCalledWith(expect.objectContaining({
  event: "add_to_cart",
  currency: "NZD",
}));
```

For the Bundle case, assert the serialized event excludes `bundleComponents`, wording, notes, upload names, and upload references. On Cart, assert `view_cart` fires after hydration; after Remove succeeds, assert one `remove_from_cart` contains the removed item snapshot and the persisted cart is empty.

- [ ] **Step 3: Run tests and confirm RED**

Run:

```bash
npm test -- --run 'src/app/products/[slug]/page.test.tsx' 'src/app/au/products/[slug]/page.test.tsx' src/components/product-configurator.test.tsx src/components/banner-bundle-configurator.test.tsx src/components/cart-view.test.tsx
```

Expected: FAIL because these storefront actions do not emit GA4 events.

- [ ] **Step 4: Add `view_item` to public product pages**

Calculate the selected/default `quoteMarketConfiguration` once on each server route. Pass both `totalInclGstCents` for display and `subtotalExGstCents` plus the stable size key for analytics. Render `AnalyticsEventTracker` inside `ProductPageContent` with scope `${market}:${product.key}:${sizeKey}` and an allowlisted `buildProductViewEvent` payload.

- [ ] **Step 5: Emit `add_to_cart` only after persistence succeeds**

In each configurator, retain the exact new `CartItem` object, save the next cart, call `notifyCartChanged()`, then call `emitAnalyticsEvent(buildCartItemEvent("add_to_cart", item))`. Do not emit when validation blocks the action or `repository.save` throws.

- [ ] **Step 6: Emit Cart view and removal events**

Render `AnalyticsEventTracker` for the hydrated non-empty cart with scope `getActiveCartStorageKey()`. Refactor the remove handler to read the current cart, capture the matching item, persist the removal, notify subscribers, then emit `remove_from_cart` from the captured snapshot. Do not include the storage key in the GA payload.

- [ ] **Step 7: Run focused tests, typecheck, and targeted lint**

Run:

```bash
npm test -- --run 'src/app/products/[slug]/page.test.tsx' 'src/app/au/products/[slug]/page.test.tsx' src/components/product-configurator.test.tsx src/components/banner-bundle-configurator.test.tsx src/components/cart-view.test.tsx
npm run typecheck
npx eslint 'src/app/products/[slug]/page-content.tsx' 'src/app/au/products/[slug]/page.tsx' src/components/product-configurator.tsx src/components/banner-bundle-configurator.tsx src/components/cart-view.tsx
```

Expected: PASS; NZ/AU prices and privacy assertions remain exact.

- [ ] **Step 8: Commit product and cart instrumentation**

Run:

```bash
git add 'src/app/products/[slug]/page-content.tsx' 'src/app/products/[slug]/page.test.tsx' 'src/app/au/products/[slug]/page.tsx' 'src/app/au/products/[slug]/page.test.tsx' src/components/product-configurator.tsx src/components/product-configurator.test.tsx src/components/banner-bundle-configurator.tsx src/components/banner-bundle-configurator.test.tsx src/components/cart-view.tsx src/components/cart-view.test.tsx
git commit -m "feat: track GA4 product and cart actions"
```

---

### Task 5: Instrument Checkout, Shipping, and Payment Submission

**Files:**
- Modify: `src/components/checkout-view.tsx`
- Modify: `src/components/checkout-view.test.tsx`
- Modify: `src/components/stripe-payment-form.tsx`
- Modify: `src/components/stripe-payment-form.test.tsx`

**Interfaces:**
- Consumes: `buildCartEvent`, `buildCheckoutEvent`, `emitAnalyticsEvent`, and `AnalyticsEventTracker`.
- Produces: `StripePaymentForm.onPaymentSubmitted?: () => void` called immediately before a valid `stripe.confirmPayment` request.
- Produces: `begin_checkout`, `add_shipping_info`, and `add_payment_info` from accepted actions.

- [ ] **Step 1: Write failing checkout funnel tests**

Assert a non-empty identity-scoped cart emits `begin_checkout` once per mounted checkout. After successful `/api/checkout/session`, shipping, and payment-method responses, assert `add_shipping_info` contains `shipping_tier`, the repriced currency, and repriced ex-tax item values. Assert a failed review emits neither shipping nor payment information.

- [ ] **Step 2: Write failing payment tests for card and external providers**

For Afterpay, assert `add_payment_info` fires only after `startOrderPayment` returns an accepted redirect/action and includes `payment_type: "afterpay"`. For card, assert opening Stripe Elements does not emit; submitting a complete Payment Element invokes `onPaymentSubmitted` once immediately before `stripe.confirmPayment`. Failed element validation may be retried and creates one event per genuine submit.

- [ ] **Step 3: Run tests and confirm RED**

Run:

```bash
npm test -- --run src/components/checkout-view.test.tsx src/components/stripe-payment-form.test.tsx
```

Expected: FAIL because checkout funnel events and the Stripe submission callback do not exist.

- [ ] **Step 4: Add `begin_checkout` and successful shipping review**

Use `AnalyticsEventTracker` with `buildCartEvent("begin_checkout", cart)` and `getActiveCartStorageKey()` as the private scope key. At the end of a successful `review()`, after all three API responses are accepted and state is populated, emit:

```ts
emitAnalyticsEvent(buildCheckoutEvent("add_shipping_info", session.checkout.cart, {
  shipping_tier: quote.shipping.option.serviceName,
}));
```

Pass only the public service name/tier; never pass address data.

- [ ] **Step 5: Add payment-info emission at the real submission boundary**

For Afterpay/Zip, emit after `startOrderPayment` resolves and before following its action. For card, pass a callback into `StripePaymentForm`; the child invokes it only after Stripe and Elements are ready and complete, immediately before `stripe.confirmPayment`. Build the payload from `reviewedCart` with `payment_type` equal to the stable method key (`card`, `afterpay`, or `zip`).

- [ ] **Step 6: Run focused checkout tests and regression checks**

Run:

```bash
npm test -- --run src/components/checkout-view.test.tsx src/components/stripe-payment-form.test.tsx src/components/payment-methods.test.tsx src/components/order-payment-panel.test.tsx
npm run typecheck
npx eslint src/components/checkout-view.tsx src/components/stripe-payment-form.tsx
```

Expected: PASS; payment recovery, payment-method switching, and mobile Stripe flows remain unchanged except for the analytics callback.

- [ ] **Step 7: Commit checkout instrumentation**

Run:

```bash
git add src/components/checkout-view.tsx src/components/checkout-view.test.tsx src/components/stripe-payment-form.tsx src/components/stripe-payment-form.test.tsx
git commit -m "feat: track GA4 checkout funnel"
```

---

### Task 6: Full Verification, Production Release, Realtime, and DebugView

**Files:**
- Create: `docs/analytics/ga4-verification-2026-08-17.md`
- Modify only if a concrete failure requires it: files already listed in Tasks 2–5

**Interfaces:**
- Consumes: all eight production event paths.
- Produces: a source-controlled verification record containing commands, event results, currency results, privacy results, deployment ID, and limitations.

- [ ] **Step 1: Run the complete automated verification**

Run:

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
git diff --check
```

Expected: every command exits `0`. Record exact test-file/test counts and the build page count; do not claim database integration unless `TEST_DATABASE_URL` is available and those tests are actually run.

- [ ] **Step 2: Run the duplicate-tag and secret/PII source audit**

Run:

```bash
rg -n "G-[A-Z0-9]+|GoogleAnalytics|GoogleTagManager|gtag\\.js|googletagmanager\\.com" src package.json package-lock.json
rg -n "fullName|email|phone|street|postcode|uploadReferences|imageUrl|designText|notes" src/domain/analytics src/components/analytics-event-tracker.tsx src/components/purchase-tracker.tsx
```

Expected: one Measurement ID constant, one root `GoogleAnalytics` render, no GTM/manual tag, and prohibited fields appear only in negative privacy tests or source input destructuring—not in emitted payload objects.

- [ ] **Step 3: Verify the release boundary against production**

Run:

```bash
git log --oneline 687899e6e2775639db72f6a3f70616d1f1c38e1e..HEAD
git diff --name-status 687899e6e2775639db72f6a3f70616d1f1c38e1e..HEAD
git status --short
```

Expected: only the approved GA4 dependency, analytics, product/cart/checkout instrumentation, tests, spec, and verification document. No Banner Bundle migration or unrelated files.

- [ ] **Step 4: Commit the verification record**

Document the automated results, then run:

```bash
git add docs/analytics/ga4-verification-2026-08-17.md
git commit -m "docs: record GA4 ecommerce verification"
```

- [ ] **Step 5: Push and deploy the exact verified commit**

Push `feat/ga4-ecommerce`, wait for its Vercel deployment to reach Ready, confirm the Source revision equals local `HEAD`, then promote that same Ready artifact to `rrgallery.co.nz`. Do not rebuild or promote another artifact.

- [ ] **Step 6: Verify the production gate**

On the production site, inspect the rendered DOM/network and confirm `G-RE5Z5B58TJ` loads once. Open a Vercel Preview for the same commit and confirm the Google tag does not load and ecommerce emission is a no-op.

- [ ] **Step 7: Verify all events in GA4 Realtime and DebugView using Chrome**

In the controlled Chrome session, start with `https://rrgallery.co.nz/?ga_debug=1`, then perform one privacy-safe NZ path covering product view, add, cart view, remove/re-add, checkout, shipping review, and payment-method submission without completing a new charge. Repeat the price/currency payload check on an enabled AU route without payment. Confirm these event names in both Realtime and DebugView:

```text
view_item
add_to_cart
remove_from_cart
view_cart
begin_checkout
add_shipping_info
add_payment_info
purchase
```

Use an already server-confirmed paid order to verify `purchase` if it can be opened safely without generating a new transaction. If a new real payment is required, stop and ask Ronnie to perform it. Confirm event details show the correct `NZD`/`AUD`, stable transaction ID for purchase, correct numeric values/items, and no prohibited PII fields or values.

- [ ] **Step 8: End debug mode and update the verification record**

Visit `https://rrgallery.co.nz/?ga_debug=0`, confirm the debug session key is removed, and append the actual Realtime/DebugView evidence and any unverified event to `docs/analytics/ga4-verification-2026-08-17.md`. If any required event is not visible, mark the release `FAILED`, fix the specific event, rerun focused/full verification, redeploy the corrected Ready artifact, and repeat the browser check.

- [ ] **Step 9: Commit final production evidence**

Run:

```bash
git add docs/analytics/ga4-verification-2026-08-17.md
git commit -m "docs: add GA4 production evidence"
git status --short
```

Expected: clean worktree and a verification document that distinguishes automated, preview, production Realtime, DebugView, NZD, AUD, and purchase results.
