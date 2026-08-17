# AU GoSweetSpot Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the temporary fixed Australian shipping amount with delivery-only GoSweetSpot rating that preserves the returned numeric amount as AUD and stores it in the authoritative checkout/order snapshot.

**Architecture:** Keep the existing server-owned cart repricing, package registry, GoSweetSpot HMAC adapter, quote persistence, and order snapshot. Add market/currency/tax context to the provider request, remove the fixed AU shortcut, and make the AU storefront delivery-only while retaining NZ Pickup/Post unchanged. Australia remains disabled after this code change.

**Tech Stack:** Next.js App Router, React, TypeScript, Zod, Vitest/Testing Library, PostgreSQL/Drizzle, existing GoSweetSpot Custom API adapter.

## Global Constraints

- Australia remains technically disabled and is not promoted or opened by this plan.
- GoSweetSpot is the shipping-rate authority for NZ and AU.
- A GoSweetSpot numeric rate of `30.00` becomes `NZ$30.00` for NZ and `A$30.00 AUD` for AU; no FX conversion is allowed.
- AU is delivery-only and must not expose Pickup/Delivery choices.
- AU GST disabled means zero tax; AU GST enabled extracts tax from the same gross AUD amount and never adds tax at checkout.
- Provider failure blocks checkout; no fixed-rate fallback is allowed.
- Existing product prices, completed orders, Stripe, Afterpay, uploads, and NZ shipping behavior must not change.
- Do not expose credentials, raw provider responses, addresses, or customer data.

---

### Task 1: Make the AU price book carrier-backed

**Files:**
- Modify: `src/domain/catalogue/market-price-book.ts`
- Modify: `src/domain/catalogue/market-price-book.test.ts`
- Modify: `src/components/admin/product-registry-form.tsx`
- Modify: `src/components/admin/product-registry-form.test.tsx`

**Interfaces:**
- Consumes: existing `MarketShippingPrice` with `source: "fixed" | "carrier"`.
- Produces: the default AU method `{ key: "au-live-carrier", method: "post", source: "carrier", active: true, amountInclTaxCents: null }`; AU completeness no longer requires a fixed shipping amount.

- [ ] **Step 1: Write failing price-book tests**

Add assertions that the default AU method is carrier-backed, accepts `null` for its amount, and a fully populated disabled AU price book no longer needs an AU shipping number:

```ts
expect(defaultProductRegistry.markets.AU.shippingMethods).toEqual([{
  key: "au-live-carrier",
  label: "GoSweetSpot live delivery",
  method: "post",
  source: "carrier",
  active: true,
  amountInclTaxCents: null,
}]);
expect(getMarketCompleteness(completeAustraliaDraft(), "AU").missingKeys)
  .not.toEqual(expect.arrayContaining([expect.stringContaining("shippingMethods")]));
```

Update `completeAustraliaDraft()` so it populates only product/option/urgent values and does not assign a shipping amount.

- [ ] **Step 2: Run the price-book test and verify RED**

Run:

```bash
npm test -- --run src/domain/catalogue/market-price-book.test.ts
```

Expected: FAIL because the current AU method is `au-standard` with `source: "fixed"` and market validation still requires fixed AU shipping.

- [ ] **Step 3: Implement the minimal carrier-backed market definition**

Change the AU default method to:

```ts
shippingMethods: [{
  key: "au-live-carrier",
  label: "GoSweetSpot live delivery",
  method: "post",
  source: "carrier",
  active: true,
  amountInclTaxCents: null,
}],
```

Replace the AU fixed-source invariant with an AU delivery-only invariant:

```ts
if (market === "AU" && book.shippingMethods.some((method) =>
  method.method !== "post" || method.source !== "carrier"
)) {
  throw new MarketPriceBookValidationError(
    "Australia shipping must use carrier-backed delivery.",
  );
}
```

Keep `getMarketCompleteness()` unchanged for carrier methods so a null carrier price is not treated as missing.

- [ ] **Step 4: Write the failing Admin form test**

Assert the AU form shows read-only carrier information and no shipping amount input:

```ts
expect(screen.getByText("GoSweetSpot live delivery")).toBeVisible();
expect(screen.getByText("Calculated from the delivery address and package sizes at checkout.")).toBeVisible();
expect(screen.queryByLabelText(/shipping.*final price/i)).not.toBeInTheDocument();
```

Assert the submitted price book retains the existing carrier method exactly rather than reading amount/label/active fields from the form.

- [ ] **Step 5: Run the Admin test and verify RED**

Run:

```bash
npm test -- --run src/components/admin/product-registry-form.test.tsx
```

Expected: FAIL because the current form exposes editable AU shipping label, amount, and active controls.

- [ ] **Step 6: Make the Admin shipping projection truthful**

In `publishAustralia`, preserve the carrier methods directly:

```ts
shippingMethods: markets.AU.shippingMethods,
```

Replace the editable shipping rows with:

```tsx
<fieldset className={styles.formPanel}>
  <legend>Australia shipping</legend>
  <p><strong>GoSweetSpot live delivery</strong></p>
  <p>Calculated from the delivery address and package sizes at checkout.</p>
</fieldset>
```

Change the confirmation copy from “fixed Australia AUD price book” to “Australia AUD price book”.

- [ ] **Step 7: Run focused tests and commit**

Run:

```bash
npm test -- --run src/domain/catalogue/market-price-book.test.ts src/components/admin/product-registry-form.test.tsx src/server/admin/product-registry-service.test.ts
npm run typecheck
```

Expected: all listed tests and TypeScript pass.

Commit:

```bash
git add src/domain/catalogue/market-price-book.ts src/domain/catalogue/market-price-book.test.ts src/components/admin/product-registry-form.tsx src/components/admin/product-registry-form.test.tsx
git commit -m "fix: make AU shipping carrier backed"
```

---

### Task 2: Make GoSweetSpot quotes market-aware without FX

**Files:**
- Modify: `src/server/shipping/types.ts`
- Modify: `src/server/shipping/gosweetspot-provider.ts`
- Modify: `src/server/shipping/gosweetspot-provider.test.ts`
- Modify: `src/server/shipping/local-test-provider.ts`
- Modify: `src/server/shipping/local-test-provider.test.ts`

**Interfaces:**
- Consumes: `Market`, `MarketCurrency`, and `MarketTaxPolicy` from `src/domain/markets/types.ts`.
- Produces: `ShippingQuoteRequest` containing `market`, `currency`, and `taxPolicy`; provider output currency and tax always match that server-owned context.

- [ ] **Step 1: Write failing AU provider tests**

Create an AU request from the existing fixture:

```ts
const auRequest: ShippingQuoteRequest = {
  ...request,
  market: "AU",
  currency: "AUD",
  taxPolicy: { jurisdiction: "NONE", registered: false, rateBasisPoints: 1_000 },
  destination: {
    ...request.destination,
    city: "NSW",
    postcode: "2000",
    countryCode: "AU",
  },
};
```

Add tests proving:

```ts
await expect(provider.quote(auRequest)).resolves.toMatchObject({
  amountExGstCents: 3_000,
  gstCents: 0,
  amountInclGstCents: 3_000,
  currency: "AUD",
});
```

and with AU GST registered:

```ts
taxPolicy: { jurisdiction: "AU_GST", registered: true, rateBasisPoints: 1_000 }
```

the same numeric `30.00` produces `2_727` ex-tax, `273` tax, `3_000` gross.

Also test rejection when `request.market`, `request.currency`, or destination country conflict.

- [ ] **Step 2: Run provider tests and verify RED**

Run:

```bash
npm test -- --run src/server/shipping/gosweetspot-provider.test.ts
```

Expected: type/test failures because the request has no market or tax policy and the provider hard-codes NZD and 15% NZ GST.

- [ ] **Step 3: Add authoritative quote context**

Extend `ShippingQuoteRequest`:

```ts
export type ShippingQuoteRequest = Readonly<{
  market: Market;
  currency: MarketCurrency;
  taxPolicy: MarketTaxPolicy;
  cartValueInclGstCents: number;
  packages: readonly ShippingPackage[];
  destination: ShippingDestination;
}>;
```

In the provider, validate:

```ts
if (request.market !== request.destination.countryCode ||
    request.currency !== currencyForMarket(request.market)) {
  throw new ShippingProviderError("The shipping market context is invalid.");
}
```

Treat the selected GoSweetSpot numeric rate as the destination currency gross amount and apply the market policy:

```ts
const grossCents = safeCents(selected.rate);
const tax = includedTaxFromGross(grossCents, request.taxPolicy);
```

Return:

```ts
amountExGstCents: tax.amountExTaxCents,
gstCents: tax.taxCents,
amountInclGstCents: tax.amountInclTaxCents,
currency: request.currency,
```

For NZ only, preserve the existing `GOSWEETSPOT_RATE_TAX_MODE=ex_gst` behavior by converting the returned ex-GST numeric rate to gross before calling `includedTaxFromGross`. For AU, the confirmed rule treats the returned numeric amount as final AUD gross regardless of account tax mode.

- [ ] **Step 4: Update local-test provider fixtures**

Make the local provider use `request.currency` and `request.taxPolicy` rather than returning hard-coded NZD. Add one AU test asserting the provider output is AUD and zero-tax when AU GST is disabled.

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
npm test -- --run src/server/shipping/gosweetspot-provider.test.ts src/server/shipping/local-test-provider.test.ts
npm run typecheck
```

Expected: both files and TypeScript pass.

Commit:

```bash
git add src/server/shipping/types.ts src/server/shipping/gosweetspot-provider.ts src/server/shipping/gosweetspot-provider.test.ts src/server/shipping/local-test-provider.ts src/server/shipping/local-test-provider.test.ts
git commit -m "feat: rate AU delivery through GoSweetSpot"
```

---

### Task 3: Remove the AU fixed shortcut from the shipping service

**Files:**
- Modify: `src/server/shipping/shipping-service.ts`
- Modify: `src/server/shipping/shipping-service.test.ts`
- Verify: `src/server/shipping/package-registry.ts`
- Verify: `src/server/shipping/package-registry.test.ts`

**Interfaces:**
- Consumes: market-aware `ShippingQuoteRequest` from Task 2 and `MarketPriceBook.tax`.
- Produces: `quotePost()` that calls the selected provider for both NZ and AU and validates the expected currency.

- [ ] **Step 1: Replace the fixed-AU regression with failing carrier tests**

Change the existing “uses fixed AUD shipping” test to assert:

```ts
expect(quoteProvider.quote).toHaveBeenCalledWith(expect.objectContaining({
  market: "AU",
  currency: "AUD",
  taxPolicy: {
    jurisdiction: "NONE",
    registered: false,
    rateBasisPoints: 1_000,
  },
  destination: expect.objectContaining({ countryCode: "AU", city: "NSW" }),
}));
expect(result.option).toMatchObject({
  currency: "AUD",
  provenance: "gosweetspot",
  amountInclGstCents: 3_000,
});
```

Make the provider fixture return the requested currency and market tax split. Assert a Bundle quantity of two still sends four packages.

Add fail-closed cases for provider missing, wrong AUD/NZD currency, expired quote, and no positive rate; assert no fixed fallback.

- [ ] **Step 2: Run the shipping service test and verify RED**

Run:

```bash
npm test -- --run src/server/shipping/shipping-service.test.ts
```

Expected: FAIL because AU currently bypasses the provider and returns `internal-fixed`.

- [ ] **Step 3: Use one carrier path for both markets**

Delete the `if (cart.market === "AU")` fixed-price branch. Build the request as:

```ts
const request: ShippingQuoteRequest = Object.freeze({
  market: cart.market,
  currency: cart.currency,
  taxPolicy: marketTaxPolicy(cart.market, priceBook?.tax),
  cartValueInclGstCents: cart.totalInclGstCents,
  packages: Object.freeze(packages),
  destination,
});
```

Call `assertCurrentPositiveQuote(quote, now(), cart.currency)` and retain existing quote persistence/provenance behavior. Remove unused `internal-fixed` construction imports and code, but keep the provider enum backward-readable for old quote rows.

- [ ] **Step 4: Verify package integrity and quote invalidation**

Run:

```bash
npm test -- --run src/server/shipping/shipping-service.test.ts src/server/shipping/package-registry.test.ts
npm run typecheck
```

Expected: carrier calls, Bundle package counts, destination/cart digest invalidation, currency validation, NZ pickup, and TypeScript all pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/shipping/shipping-service.ts src/server/shipping/shipping-service.test.ts
git commit -m "fix: quote AU shipping from live packages"
```

---

### Task 4: Make AU storefront and checkout delivery-only

**Files:**
- Modify: `src/components/product-configurator.tsx`
- Modify: `src/components/product-configurator.test.tsx`
- Modify: `src/components/banner-bundle-configurator.tsx`
- Modify: `src/components/banner-bundle-configurator.test.tsx`
- Modify: `src/components/checkout-view.tsx`
- Modify: `src/components/checkout-view.test.tsx`
- Modify: `src/server/checkout/checkout-service.ts`
- Modify: `src/server/checkout/checkout-service.test.ts`

**Interfaces:**
- Consumes: normalized shipping destination country and existing cart `deliveryPreference`.
- Produces: AU cart/session delivery method always `post`; NZ still exposes and persists Pickup/Post.

- [ ] **Step 1: Write failing AU configurator tests**

Render each configurator with `market="AU"` and a completed disabled AU registry. Assert:

```ts
expect(screen.queryByRole("radiogroup", { name: "Delivery" })).not.toBeInTheDocument();
expect(screen.queryByText("Pickup")).not.toBeInTheDocument();
```

Choose “Send Photos After Ordering”, add to cart, and assert:

```ts
expect(stored.items[0].deliveryPreference).toBe("post");
```

Retain the existing NZ test that exposes two choices and stores pickup.

- [ ] **Step 2: Run configurator tests and verify RED**

Run:

```bash
npm test -- --run src/components/product-configurator.test.tsx src/components/banner-bundle-configurator.test.tsx
```

Expected: FAIL because AU currently renders a one-option Delivery radio group.

- [ ] **Step 3: Hide AU delivery controls and force post locally**

In both configurators, render the complete Delivery fieldset only for NZ:

```tsx
{market === "NZ" ? (
  <fieldset className={styles.formField} role="radiogroup">
    <legend>Delivery</legend>
    <div className={styles.deliveryChoices}>
      <label>
        <input
          type="radio"
          name="delivery-preference"
          checked={deliveryPreference === "post"}
          onChange={() => setDeliveryPreference("post")}
        />
        Post
      </label>
      <label>
        <input
          type="radio"
          name="delivery-preference"
          checked={deliveryPreference === "pickup"}
          onChange={() => setDeliveryPreference("pickup")}
        />
        Pickup
      </label>
    </div>
    <p className={styles.deliveryScopeNote}>This choice applies to your whole order.</p>
  </fieldset>
) : null}
```

When adding an AU item, pass `"post"` to `setCartDeliveryPreference` regardless of stale local state:

```ts
const effectiveDeliveryPreference = market === "AU" ? "post" : deliveryPreference;
```

- [ ] **Step 4: Write failing checkout/server tests**

In `checkout-view.test.tsx`, create a cart whose first item carries stale `pickup`, enter an AU delivery address, review, and assert the session request contains:

```ts
expect(body.deliveryMethod).toBe("post");
```

In `checkout-service.test.ts`, assert a direct AU `pickup` input is rejected and an AU `post` input calls `quotePost` with the AU snapshot/address.

- [ ] **Step 5: Run checkout tests and verify RED**

Run:

```bash
npm test -- --run src/components/checkout-view.test.tsx src/server/checkout/checkout-service.test.ts
```

Expected: the client test fails because it sends stale pickup; the server rejection test remains green as a security boundary.

- [ ] **Step 6: Force post from the normalized destination at review**

In `CheckoutView.review()`, derive the destination used by the request and choose:

```ts
const reviewDestination = different ? deliveryResult.data : billingResult.data;
const deliveryMethod = reviewDestination.country === "AU" ? "post" : method;
```

Send `deliveryMethod` in the session request. Keep the server-side AU pickup rejection unchanged so browser input is never trusted.

- [ ] **Step 7: Run focused tests and commit**

Run:

```bash
npm test -- --run src/components/product-configurator.test.tsx src/components/banner-bundle-configurator.test.tsx src/components/checkout-view.test.tsx src/server/checkout/checkout-service.test.ts
npm run typecheck
```

Expected: all focused tests and TypeScript pass.

Commit:

```bash
git add src/components/product-configurator.tsx src/components/product-configurator.test.tsx src/components/banner-bundle-configurator.tsx src/components/banner-bundle-configurator.test.tsx src/components/checkout-view.tsx src/components/checkout-view.test.tsx src/server/checkout/checkout-service.ts src/server/checkout/checkout-service.test.ts
git commit -m "fix: make AU checkout delivery only"
```

---

### Task 5: Verify the complete release boundary

**Files:**
- Modify only if a concrete regression fails: files already listed in Tasks 1–4
- Create: `.superpowers/sdd/2026-08-17-au-gosweetspot-delivery/verification.md`

**Interfaces:**
- Consumes: all Task 1–4 commits.
- Produces: exact verification evidence without enabling AU or calling a real payment provider.

- [ ] **Step 1: Run all focused shipping and checkout tests**

```bash
npm test -- --run \
  src/domain/catalogue/market-price-book.test.ts \
  src/components/admin/product-registry-form.test.tsx \
  src/server/admin/product-registry-service.test.ts \
  src/server/shipping/gosweetspot-provider.test.ts \
  src/server/shipping/local-test-provider.test.ts \
  src/server/shipping/shipping-service.test.ts \
  src/server/shipping/package-registry.test.ts \
  src/components/product-configurator.test.tsx \
  src/components/banner-bundle-configurator.test.tsx \
  src/components/checkout-view.test.tsx \
  src/server/checkout/checkout-service.test.ts \
  src/app/api/checkout/shipping/route.test.ts \
  src/app/api/checkout/order/route.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run static verification**

```bash
npm run typecheck
npm run lint
git diff --check afaad69..HEAD
```

Expected: all exit zero.

- [ ] **Step 3: Run the complete test suite with the existing isolated test database environment**

```bash
set -a
source .env.local
set +a
npm test -- --run
```

Expected: all test files pass. Do not print environment values. If `TEST_DATABASE_URL` is unavailable or not an isolated test database, record database suites as not run rather than using production.

- [ ] **Step 4: Run production build with safe existing environment configuration**

```bash
npm run build
```

Expected: production build exits zero; AU remains disabled/noindex.

- [ ] **Step 5: Record the exact evidence and commit**

Write the commands, exit codes, test counts, build result, commit range, and these explicit limitations to the verification file:

```md
- Australia was not enabled.
- No live payment was started.
- No shipment or label was created.
- Automated provider tests used mocked GoSweetSpot responses.
- Production GoSweetSpot AU rating remains a post-deployment smoke check after the code is released while AU stays closed.
```

Commit:

```bash
git add .superpowers/sdd/2026-08-17-au-gosweetspot-delivery/verification.md
git commit -m "docs: verify AU GoSweetSpot delivery"
```

- [ ] **Step 6: Stop before deployment**

Report the exact commit range and verification. Do not enable AU or deploy until the user explicitly approves the verified release boundary.
