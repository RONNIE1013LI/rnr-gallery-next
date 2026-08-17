# Banner Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one market-priced Banner Bundle product with two independent customisation/upload groups, authoritative checkout and order persistence, and correct NZ/AU shipping behavior.

**Architecture:** Keep the Bundle as one catalogue product and one cart/order item, with a typed `bundleComponents` payload for the Roll-Up and Wall Banner customisations. Extend the existing managed market price book with exact NZ gross prices and component-specific option charges, then reuse the existing upload, identity, checkout, order, payment, and retention boundaries. New Zealand shipping expands one bundle item into the two existing physical package profiles; Australian checkout keeps the current fixed AUD delivery method.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod, Drizzle/PostgreSQL, Vitest/Testing Library, Playwright CLI, Vercel Blob, GoSweetSpot, Stripe, Afterpay.

## Global Constraints

- Product key and slug are exactly `banner-bundle`; workflow key is `banner_bundle`.
- Roll-Up size is fixed at 85 × 200 cm.
- Wall Banner choices are 200 × 100 cm and 300 × 150 cm.
- NZ prices are exact gross cents: `35_999` and `48_999`; they include 15% NZ GST.
- AU prices are fixed AUD cents: `33_999` and `46_999`; never convert from NZD.
- Each component independently supports Upload Now or Send Later, wording, instructions, main photo, and background removal.
- Each component includes five photos and accepts at most 50; extra-photo pricing is component-specific.
- Preserve Guest/User cart isolation, pending-checkout isolation, and payment-recovery isolation.
- Preserve completed orders, payment-provider amount calculation, current shipping prices, and five-day source-photo retention.
- Do not emit customer wording, upload names, image URLs, or other PII to analytics or structured data.
- Exclude this product from Merchant/advertising output until an advertising-safe image is approved.
- Do not add dependencies or refactor unrelated products.

## File and interface map

- `src/domain/catalogue/products.ts`: baseline product and exact product image.
- `src/domain/configuration/types.ts`, `schemas.ts`: Bundle sizes and exact NZ gross-price override.
- `src/domain/catalogue/market-price-book.ts`: new component charge keys, exact gross prices, AU fixed prices, and old-registry upgrade support.
- `src/domain/catalogue/product-registry.ts`: safe insertion of the new immutable product into existing published revision snapshots.
- `src/components/admin/product-registry-form.tsx`, `src/server/admin/product-registry-service.ts`: exact NZ retail-price editing.
- `src/domain/bundles/banner-bundle.ts`: Bundle component keys, validation helpers, photo/charge counts, and flattened upload references.
- `src/domain/cart/types.ts`, `checkout-input.ts`, `browser-cart-repository.ts`: optional Bundle payload in identity-scoped browser state.
- `src/domain/checkout/types.ts`, `input-schema.ts`, `reprice-cart.ts`: server validation and authoritative Bundle repricing.
- `src/components/source-photo-customisation.tsx`: reusable upload group UI/state extracted from the existing configurator.
- `src/components/banner-bundle-configurator.tsx`: two independent customisation groups and one Add to Cart action.
- `src/app/products/[slug]/configure/page-content.tsx`: dispatch to the Bundle configurator only for `banner-bundle`.
- `src/server/db/schema/orders.ts`, `drizzle/0029_banner_bundle_components.sql`: nullable JSON snapshot on order items.
- `src/server/orders/drizzle-order-repository.ts`, order query DTOs and Admin/customer views: persist and display both groups.
- `src/server/shipping/package-registry.ts`, `shipping-service.ts`: two physical packages for one Bundle quantity.
- `src/domain/catalogue/merchant-product-data.ts`: explicit advertising exclusion.

---

### Task 1: Add the catalogue product, image, exact market prices, and safe registry upgrade

**Files:**
- Copy: `/Users/ronnieli/Downloads/landscape-roll-up-bundle.png` → `public/media/products/banner-bundle.png`
- Modify: `src/domain/catalogue/products.ts`
- Modify: `src/domain/catalogue/types.ts`
- Modify: `src/domain/configuration/types.ts`
- Modify: `src/domain/configuration/schemas.ts`
- Modify: `src/domain/catalogue/market-price-book.ts`
- Modify: `src/domain/catalogue/product-registry.ts`
- Test: `src/domain/catalogue/catalogue.test.ts`
- Test: `src/domain/configuration/schemas.test.ts`
- Test: `src/domain/catalogue/market-price-book.test.ts`
- Test: `src/domain/catalogue/product-registry.test.ts`

**Interfaces:**
- Produces: `ConfigurationSize.nzAmountInclTaxCents?: number`.
- Produces: `MarketChargeKey = "extra-photo" | "background-removal" | "roll-up-extra-photo" | "roll-up-background-removal" | "wall-banner-extra-photo" | "wall-banner-background-removal"`.
- Produces: a parsed registry containing `banner-bundle` even when the stored revision predates the product.

- [ ] **Step 1: Write failing catalogue and schema tests**

Add assertions equivalent to:

```ts
expect(getProductBySlug("banner-bundle")).toMatchObject({
  category: "banners",
  workflowKey: "banner_bundle",
  image: { src: "/media/products/banner-bundle.png" },
});

expect(getConfigurationSchema("banner-bundle")).toMatchObject({
  defaultSizeKey: "rollup-wall-200x100",
  sizes: [
    { key: "rollup-wall-200x100", nzAmountInclTaxCents: 35_999 },
    { key: "rollup-wall-300x150", nzAmountInclTaxCents: 48_999 },
  ],
  includedPhotos: 5,
  maximumSourcePhotos: 50,
});
```

Add a registry-upgrade fixture by cloning the current default registry, removing the Bundle product and market rows, changing an existing AU price and tax setting, then assert `parseProductRegistry` restores only the Bundle and preserves those edited values.

- [ ] **Step 2: Run the focused tests and verify the new product is missing**

Run:

```bash
npm test -- --run src/domain/catalogue/catalogue.test.ts src/domain/configuration/schemas.test.ts src/domain/catalogue/market-price-book.test.ts src/domain/catalogue/product-registry.test.ts
```

Expected: FAIL because `banner-bundle`, its sizes, and upgrade rows do not exist.

- [ ] **Step 3: Copy the supplied image and add the baseline product/schema**

Copy the file without resizing:

```bash
cp /Users/ronnieli/Downloads/landscape-roll-up-bundle.png public/media/products/banner-bundle.png
```

Add this product shape to `products.ts`:

```ts
{
  key: "banner-bundle",
  slug: "banner-bundle",
  category: "banners",
  workflowKey: "banner_bundle",
  title: "Banner Bundle",
  summary: "A complete 85 × 200 cm roll-up banner and matching wall banner package, customised separately for your event.",
  image: PRODUCT_SHOP_IMAGES["banner-bundle"],
  startingPriceExGstCents: 31_303,
  active: true,
  featured: false,
}
```

Add schema sizes with `priceExGstCents` equal to the ex-GST portion extracted from gross (`31_303`, `42_608`) and the exact `nzAmountInclTaxCents` values (`35_999`, `48_999`). Use `orientationMode: "none"`, no people/pet pricing, five included photos, 50 maximum photos per component, the existing Banner extra-photo/background-removal defaults, and existing post/pickup preferences.

- [ ] **Step 4: Extend the market price book without changing existing products**

Define `MarketChargeKey`, use `size.nzAmountInclTaxCents ?? addNzGst(size.priceExGstCents)` for NZ sizes, and create Bundle AU sizes with the fixed cents from Global Constraints.

For the Bundle, create the four component-specific charge keys. NZ values come from the corresponding Roll-Up and Custom Themed Wall Banner configuration. AU upgrade values copy the corresponding charge cells from the currently stored Roll-Up and Wall Banner market rows; this keeps a complete enabled AU book complete.

- [ ] **Step 5: Normalize older published registry revisions before schema validation**

Add a pure function with this signature:

```ts
function addMissingBaselineProducts(value: unknown): unknown
```

It must clone the value, append only missing baseline products, and append only their missing NZ/AU market rows. Call it before `documentSchema.safeParse`. Never replace existing rows or market settings.

- [ ] **Step 6: Run focused tests**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add public/media/products/banner-bundle.png src/domain/catalogue/products.ts src/domain/catalogue/types.ts src/domain/configuration/types.ts src/domain/configuration/schemas.ts src/domain/catalogue/market-price-book.ts src/domain/catalogue/product-registry.ts src/domain/catalogue/catalogue.test.ts src/domain/configuration/schemas.test.ts src/domain/catalogue/market-price-book.test.ts src/domain/catalogue/product-registry.test.ts
git commit -m "feat: add banner bundle catalogue pricing"
```

---

### Task 2: Make Bundle NZ/AU prices editable and keep Merchant advertising excluded

**Files:**
- Modify: `src/components/admin/product-registry-form.tsx`
- Modify: `src/server/admin/product-admin-service.ts`
- Modify: `src/server/admin/product-registry-service.ts`
- Modify: `src/domain/catalogue/merchant-product-data.ts`
- Test: `src/components/admin/product-registry-form.test.tsx`
- Test: `src/server/admin/product-registry-service.test.ts`
- Test: `src/domain/catalogue/merchant-product-data.test.ts`

**Interfaces:**
- Consumes: `ConfigurationSize.nzAmountInclTaxCents` and Bundle component charge keys from Task 1.
- Produces: Admin PATCH payload size rows with optional `nzAmountInclTaxCents`.

- [ ] **Step 1: Write failing Admin and Merchant tests**

Assert the Bundle Admin card shows:

```ts
screen.getByLabelText("rollup-wall-200x100 final price incl GST (NZD)")
screen.getByLabelText("Banner Bundle · rollup-wall-200x100 final price (AUD)")
```

Submit `359.99` and verify the PATCH body contains `nzAmountInclTaxCents: 35_999`. Add a Merchant test asserting no returned entry has `productKey === "banner-bundle"` while other active products remain.

- [ ] **Step 2: Run focused tests and verify failures**

```bash
npm test -- --run src/components/admin/product-registry-form.test.tsx src/server/admin/product-registry-service.test.ts src/domain/catalogue/merchant-product-data.test.ts
```

Expected: FAIL because exact NZ gross editing and Merchant exclusion do not exist.

- [ ] **Step 3: Add exact NZ gross editing**

For sizes with `nzAmountInclTaxCents !== undefined`, render a required `final price incl GST (NZD)` input and send both the exact gross cents and its derived ex-GST cents. For legacy sizes, retain the current ex-GST input unchanged.

Extend `productPatchSchema` size rows:

```ts
nzAmountInclTaxCents: cents.optional(),
```

When publishing, preserve or delete the optional field exactly as supplied, then call `synchronizeNewZealandPriceBook`.

- [ ] **Step 4: Exclude the Bundle from Merchant output**

Add a narrow explicit set:

```ts
const MERCHANT_EXCLUDED_PRODUCT_KEYS = new Set(["banner-bundle"]);
```

Return no Merchant entries for keys in that set. Do not change JSON-LD or normal public catalogue visibility.

- [ ] **Step 5: Run focused tests and commit**

Run the Step 2 command. Expected: PASS.

```bash
git add src/components/admin/product-registry-form.tsx src/server/admin/product-admin-service.ts src/server/admin/product-registry-service.ts src/domain/catalogue/merchant-product-data.ts src/components/admin/product-registry-form.test.tsx src/server/admin/product-registry-service.test.ts src/domain/catalogue/merchant-product-data.test.ts
git commit -m "feat: manage banner bundle market prices"
```

---

### Task 3: Add typed Bundle customisations and authoritative pricing

**Files:**
- Create: `src/domain/bundles/banner-bundle.ts`
- Create: `src/domain/bundles/banner-bundle.test.ts`
- Modify: `src/domain/cart/types.ts`
- Modify: `src/domain/checkout/types.ts`
- Modify: `src/domain/checkout/input-schema.ts`
- Modify: `src/domain/checkout/reprice-cart.ts`
- Modify: `src/domain/pricing/market-quote.ts`
- Test: `src/domain/checkout/reprice-cart.test.ts`
- Test: `src/domain/pricing/market-quote.test.ts`

**Interfaces:**
- Produces: `BannerBundleComponentKey`, `BannerBundleComponentCustomization`, `getBannerBundleCounts`, and `flattenBannerBundleUploadReferences`.
- Produces: optional `bundleComponents` on Cart, canonical checkout, and repriced checkout items.

- [ ] **Step 1: Write failing domain tests**

Use this canonical type:

```ts
export type BannerBundleComponentKey = "roll-up" | "wall-banner";

export type BannerBundleComponentCustomization = Readonly<{
  componentKey: BannerBundleComponentKey;
  photoSubmissionMethod: PhotoSubmissionMethod;
  designText: string;
  notes: string;
  uploadReferences: readonly string[];
  mainPhotoUploadId?: string;
  extraBackgroundRemovalUploadIds?: readonly string[];
}>;
```

Test exact validation for two unique keys, Upload Now requiring at least one reference, Send Later allowing zero references, no duplicated upload ID across groups, maximum 50 references per group, and component-specific extra counts for 5/5, 6/5, 5/6, and 10/10.

Add quote expectations:

- Bundle small NZ base = `35_999`.
- Bundle large NZ base = `48_999`.
- Bundle small AU base = `33_999`.
- One Roll-Up extra and two Wall extras create separate price lines with the correct existing component market rates.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
npm test -- --run src/domain/bundles/banner-bundle.test.ts src/domain/checkout/reprice-cart.test.ts src/domain/pricing/market-quote.test.ts
```

Expected: FAIL because Bundle component types and pricing selection do not exist.

- [ ] **Step 3: Implement pure Bundle validation/counting helpers**

Export:

```ts
export function validateBannerBundleComponents(
  value: readonly BannerBundleComponentCustomization[],
): readonly BannerBundleComponentCustomization[];

export function getBannerBundleCounts(
  value: readonly BannerBundleComponentCustomization[],
): Readonly<{
  rollUpExtraPhotos: number;
  wallBannerExtraPhotos: number;
  rollUpBackgroundRemovals: number;
  wallBannerBackgroundRemovals: number;
}>;

export function flattenBannerBundleUploadReferences(
  value: readonly BannerBundleComponentCustomization[],
): readonly string[];
```

Freeze returned arrays/objects and reject invalid data with `InvalidCheckoutCartError` at the checkout boundary.

- [ ] **Step 4: Extend checkout input schema and server repricing**

Add an optional `bundleComponents` array with exactly two component objects. Keep all existing flat fields for compatibility. Require Bundle data only when `productKey === "banner-bundle"`; reject it for all other products.

Pass component counts to `quoteMarketConfiguration` using:

```ts
bundleCounts?: Readonly<{
  rollUpExtraPhotos: number;
  wallBannerExtraPhotos: number;
  rollUpBackgroundRemovals: number;
  wallBannerBackgroundRemovals: number;
}>;
```

Emit separate gross price lines for each non-zero component charge, then use the existing market tax policy and immutable quote output.

- [ ] **Step 5: Run focused tests and commit**

Run the Step 2 command. Expected: PASS.

```bash
git add src/domain/bundles/banner-bundle.ts src/domain/bundles/banner-bundle.test.ts src/domain/cart/types.ts src/domain/checkout/types.ts src/domain/checkout/input-schema.ts src/domain/checkout/reprice-cart.ts src/domain/pricing/market-quote.ts src/domain/checkout/reprice-cart.test.ts src/domain/pricing/market-quote.test.ts
git commit -m "feat: price banner bundle customisations"
```

---

### Task 4: Build two independent upload/customisation groups

**Files:**
- Create: `src/components/source-photo-customisation.tsx`
- Create: `src/components/source-photo-customisation.test.tsx`
- Create: `src/components/banner-bundle-configurator.tsx`
- Create: `src/components/banner-bundle-configurator.test.tsx`
- Modify: `src/components/product-configurator.tsx`
- Modify: `src/app/products/[slug]/configure/page-content.tsx`
- Modify: `src/components/storefront.module.css`

**Interfaces:**
- Consumes: Bundle component types and quote selection from Task 3.
- Produces: exported `UploadedFile`, `SourcePhotoCustomisationValue`, and `BannerBundleConfigurator` types/components.

- [ ] **Step 1: Write failing reusable upload-group tests**

Define the controlled value:

```ts
export type SourcePhotoCustomisationValue = Readonly<{
  photoSubmissionMethod: PhotoSubmissionMethod;
  designText: string;
  notes: string;
  uploadedFiles: readonly UploadedFile[];
  mainPhotoUploadId?: string;
  extraBackgroundRemovalUploadIds: readonly string[];
}>;
```

Test that two rendered groups have separately labelled file inputs, method radio groups, wording, notes, upload errors, main-photo controls, and background-removal controls. Uploading/removing/toggling in Roll-Up must not change Wall Banner state. Switching one group to Send Later must retain its uploaded-file state but return no active upload references for that group.

- [ ] **Step 2: Run UI tests and verify failure**

```bash
npm test -- --run src/components/source-photo-customisation.test.tsx src/components/banner-bundle-configurator.test.tsx
```

Expected: FAIL because both components are absent.

- [ ] **Step 3: Export the upload-file type and extract the existing source-photo UI without behavior changes**

Move the current local `UploadedFile` type to an exported definition in `source-photo-customisation.tsx`, then move only the upload/method/main-photo/background-removal state and markup from `ProductConfigurator` into `SourcePhotoCustomisation`. Keep `/api/uploads`, `URL.createObjectURL`, removal cleanup, accepted file behavior, error copy, and accessibility labels unchanged. Update existing `product-configurator.test.tsx` before continuing and verify its current upload tests still pass.

- [ ] **Step 4: Implement `BannerBundleConfigurator`**

Render the existing artwork preview, size selector, timing, delivery, trust strip, and Add to Cart patterns once. Render `SourcePhotoCustomisation` twice with labels `Roll-Up Banner customisation` and `Wall Banner customisation`.

Build one Cart item whose flat `uploadReferences` is the frozen union of both groups and whose `bundleComponents` preserves each group. Calculate the preview quote with the component-specific counts from Task 3.

- [ ] **Step 5: Dispatch only the Bundle route to the new configurator**

In `ConfigurePageContent`:

```tsx
{product.key === "banner-bundle" ? (
  <BannerBundleConfigurator {...sharedProps} />
) : (
  <ProductConfigurator {...sharedProps} />
)}
```

Do not change any other product route behavior.

- [ ] **Step 6: Add responsive CSS and run tests**

At 390 px, stack the two groups and keep each error beside its own control. On desktop, retain the current configurator width and use vertical sections rather than placing two upload grids side by side.

Run:

```bash
npm test -- --run src/components/source-photo-customisation.test.tsx src/components/banner-bundle-configurator.test.tsx src/components/product-configurator.test.tsx src/app/products/'[slug]'/configure/page.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/components/source-photo-customisation.tsx src/components/source-photo-customisation.test.tsx src/components/banner-bundle-configurator.tsx src/components/banner-bundle-configurator.test.tsx src/components/product-configurator.tsx src/app/products/'[slug]'/configure/page-content.tsx src/components/storefront.module.css
git commit -m "feat: add banner bundle configurator"
```

---

### Task 5: Preserve Bundle data through identity-scoped Cart and Checkout

**Files:**
- Modify: `src/domain/cart/checkout-input.ts`
- Modify: `src/domain/cart/browser-cart-repository.ts`
- Modify: `src/domain/cart/browser-cart-repository.test.ts`
- Modify: `src/components/cart-view.tsx`
- Modify: `src/components/cart-view.test.tsx`
- Modify: `src/components/checkout-entry-summary.tsx`
- Modify: `src/components/checkout-entry-summary.test.tsx`
- Modify: `src/components/checkout-order-summary.tsx`
- Modify: `src/components/checkout-order-summary.test.tsx`
- Modify: `src/components/pending-checkout.ts`
- Modify: `src/components/pending-checkout.test.ts`
- Modify: existing cart/auth identity isolation tests

**Interfaces:**
- Consumes: `CartItem.bundleComponents` and canonical checkout Bundle payload from Task 3.
- Produces: checkout JSON containing both component groups and display summaries that never show upload filenames.

- [ ] **Step 1: Write failing Cart/Checkout persistence tests**

Create a Bundle fixture with Roll-Up=`upload` and Wall Banner=`later`. Assert:

- browser repository round-trips both groups;
- `cartToCheckoutInput` preserves both groups;
- Cart and checkout summaries render each component's method and photo count;
- no upload filename or customer wording appears in the summary;
- pending checkout recovery preserves Bundle groups only within the current identity namespace;
- Guest → A → sign out → B never exposes another identity's Bundle customisations.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
npm test -- --run src/domain/cart/browser-cart-repository.test.ts src/components/cart-view.test.tsx src/components/checkout-entry-summary.test.tsx src/components/checkout-order-summary.test.tsx src/components/pending-checkout.test.ts src/components/commerce-identity-provider.test.tsx
```

Expected: FAIL at Bundle round-trip or rendering.

- [ ] **Step 3: Preserve validated Bundle groups in browser parsing and checkout conversion**

Deep-copy/freeze each component array and nested upload array when loading/saving. Invalid partial Bundle state must cause that item to be rejected without clearing unrelated valid items or another identity's storage namespace.

- [ ] **Step 4: Render privacy-safe component summaries**

For each component show only:

- component label;
- Upload Now or Send Later;
- uploaded photo count;
- whether additional background removal was selected.

Do not show file names, blob URLs, wording, or design notes in public Cart/Checkout summaries.

- [ ] **Step 5: Run focused tests and commit**

Run the Step 2 command. Expected: PASS.

```bash
git add src/domain/cart/checkout-input.ts src/domain/cart/browser-cart-repository.ts src/domain/cart/browser-cart-repository.test.ts src/components/cart-view.tsx src/components/cart-view.test.tsx src/components/checkout-entry-summary.tsx src/components/checkout-entry-summary.test.tsx src/components/checkout-order-summary.tsx src/components/checkout-order-summary.test.tsx src/components/pending-checkout.ts src/components/pending-checkout.test.ts src/components/commerce-identity-provider.test.tsx
git commit -m "feat: preserve banner bundle checkout state"
```

---

### Task 6: Persist both component groups on orders and expose them securely to staff

**Files:**
- Modify: `src/server/db/schema/orders.ts`
- Create: `drizzle/0029_banner_bundle_components.sql`
- Modify: `drizzle/meta/_journal.json`
- Create/modify: generated `drizzle/meta/0029_snapshot.json`
- Modify: `src/server/orders/drizzle-order-repository.ts`
- Modify: `src/server/orders/order-service.ts`
- Modify: `src/server/orders/drizzle-order-query-repository.ts`
- Modify: `src/server/orders/order-query-service.ts`
- Modify: `src/components/order-detail.tsx`
- Modify: `src/components/admin/order-detail.tsx`
- Test: `src/server/db/schema/checkout-schema.test.ts`
- Test: `src/server/orders/drizzle-order-repository.test.ts`
- Test: `src/server/orders/drizzle-order-query-repository.test.ts`
- Create: `src/components/order-detail.test.tsx`
- Create: `src/components/admin/order-detail.test.tsx`

**Interfaces:**
- Consumes: validated repriced `bundleComponents` from Task 3.
- Produces: nullable `order_items.bundle_components` JSONB with the two immutable component snapshots.

- [ ] **Step 1: Write failing schema/repository/view tests**

Assert the schema exposes `bundle_components`, normal product rows store `null`, Bundle rows store exactly two groups, and the union of group upload IDs is claimed once by the order item. Query DTO tests must remove upload references from unauthorised/public list shapes while authorised detail views can show secure download controls grouped by component.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
npm test -- --run src/server/db/schema/checkout-schema.test.ts src/server/orders/drizzle-order-repository.test.ts src/server/orders/drizzle-order-query-repository.test.ts src/components/order-detail.test.tsx src/components/admin/order-detail.test.tsx
```

Expected: FAIL because the JSON column and view groups do not exist.

- [ ] **Step 3: Add the nullable JSONB column and migration**

Add:

```ts
bundleComponents: jsonb("bundle_components")
  .$type<readonly BannerBundleComponentCustomization[]>(),
```

Generate the migration with the repository's existing Drizzle command, then verify the SQL is exactly:

```sql
ALTER TABLE "order_items" ADD COLUMN "bundle_components" jsonb;
```

Do not update existing rows or completed-order totals.

- [ ] **Step 4: Persist, claim, query, and render**

Insert a deep-frozen Bundle snapshot for Bundle items. Continue claiming the single flattened upload-reference union, but use the snapshot to group authorised downloads. Ensure source-photo tombstones and five-day cleanup still reference the same checkout upload rows.

- [ ] **Step 5: Run focused tests and database tests when safe**

Run the Step 2 command. If an isolated `TEST_DATABASE_URL` is available, also run:

```bash
npm test -- --run src/server/orders/drizzle-order-repository.integration.test.ts
```

If it is unavailable, record that exact limitation and do not substitute production `DATABASE_URL`.

- [ ] **Step 6: Commit Task 6**

```bash
git add src/server/db/schema/orders.ts drizzle/0029_banner_bundle_components.sql drizzle/meta/_journal.json drizzle/meta/0029_snapshot.json src/server/orders/drizzle-order-repository.ts src/server/orders/order-service.ts src/server/orders/drizzle-order-query-repository.ts src/server/orders/order-query-service.ts src/components/order-detail.tsx src/components/admin/order-detail.tsx src/server/db/schema/checkout-schema.test.ts src/server/orders/drizzle-order-repository.test.ts src/server/orders/drizzle-order-query-repository.test.ts src/components/order-detail.test.tsx src/components/admin/order-detail.test.tsx
git commit -m "feat: store banner bundle order details"
```

---

### Task 7: Send two physical packages for NZ live-carrier quotes

**Files:**
- Modify: `src/server/shipping/package-registry.ts`
- Modify: `src/server/shipping/package-registry.test.ts`
- Modify: `src/server/shipping/shipping-service.ts`
- Modify: `src/server/shipping/shipping-service.test.ts`
- Modify: `src/server/shipping/gosweetspot-provider.test.ts`

**Interfaces:**
- Produces: `getPackageProfiles(productKey: string, sizeKey: string): readonly PackageProfile[]`.
- Keeps: `getPackageProfile` for existing one-package callers/tests until all callers migrate.

- [ ] **Step 1: Write failing package-expansion tests**

Assert:

```ts
expect(getPackageProfiles("banner-bundle", "rollup-wall-200x100"))
  .toEqual([
    expect.objectContaining({ lengthMm: 900, weightGrams: 3_000 }),
    expect.objectContaining({ lengthMm: 1_040, weightGrams: 1_000 }),
  ]);

expect(getPackageProfiles("banner-bundle", "rollup-wall-300x150"))
  .toEqual([
    expect.objectContaining({ lengthMm: 900, weightGrams: 3_000 }),
    expect.objectContaining({ lengthMm: 1_550, weightGrams: 3_000 }),
  ]);
```

Shipping-service tests must assert two provider products per Bundle quantity, their unit-price cents sum exactly to the configured Bundle unit total, and the AU path still returns one fixed AUD shipping option without calling the provider.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
npm test -- --run src/server/shipping/package-registry.test.ts src/server/shipping/shipping-service.test.ts src/server/shipping/gosweetspot-provider.test.ts
```

Expected: FAIL because only one package profile can be returned.

- [ ] **Step 3: Implement package expansion and exact value allocation**

For existing products return a one-element array. For Bundle sizes return the existing Roll-Up profile plus the corresponding Wall Banner profile. Allocate the Bundle unit value by integer weight proportion, place any remainder on the first package, and assert:

```ts
allocated.reduce((sum, value) => sum + value, 0) === item.unitPrice.totalInclGstCents
```

Quantity repeats both packages. Keep `cartvalue` equal to the authoritative cart total.

- [ ] **Step 4: Run focused tests and commit**

Run the Step 2 command. Expected: PASS.

```bash
git add src/server/shipping/package-registry.ts src/server/shipping/package-registry.test.ts src/server/shipping/shipping-service.ts src/server/shipping/shipping-service.test.ts src/server/shipping/gosweetspot-provider.test.ts
git commit -m "feat: quote banner bundle shipping packages"
```

---

### Task 8: Verify public pages, metadata, analytics privacy, and payment totals

**Files:**
- Modify: `src/domain/analytics/events.test.ts`
- Modify: `src/domain/catalogue/merchant-product-data.test.ts`
- Modify: `src/app/products/[slug]/page.test.tsx`
- Create: `src/app/shop/page.test.tsx`
- Create: `src/app/banners/page.test.tsx`
- Modify: `src/server/orders/order-pricing-snapshot.test.ts`
- Modify: `src/server/payments/payment-service.test.ts`
- Modify: `src/server/payments/stripe-provider.test.ts`
- Modify: `src/server/payments/afterpay-provider.test.ts`
- Modify only if a failing assertion requires it: `src/domain/analytics/events.ts`
- Modify only if a failing assertion requires it: `src/app/products/[slug]/page-content.tsx`
- Modify only if a failing assertion requires it: `src/server/orders/order-pricing-snapshot.ts`
- Modify only if a failing assertion requires it: `src/server/payments/payment-service.ts`
- Modify only if a failing assertion requires it: `src/server/payments/stripe-provider.ts`
- Modify only if a failing assertion requires it: `src/server/payments/afterpay-provider.ts`

**Interfaces:**
- Consumes all completed Bundle behavior.
- Produces no new production interface; this task closes cross-surface consistency gaps.

- [ ] **Step 1: Add failing cross-surface regression tests**

Assert:

- Shop and Banners list Banner Bundle with the supplied image.
- NZ and AU Product JSON-LD parse and contain the selected market currency/starting amount.
- Merchant output still excludes the Bundle.
- analytics event payloads may include `banner-bundle` and size key but cannot contain `bundleComponents`, wording, notes, upload references, filenames, or image URLs.
- order pricing snapshot contains market/currency/tax/price lines but excludes personal Bundle customisation content.
- Stripe receives `nzd`/`aud` and Afterpay receives the exact order total already stored by the order service.

- [ ] **Step 2: Run the exact cross-surface tests**

Run:

```bash
npm test -- --run \
  src/domain/analytics/events.test.ts \
  src/domain/catalogue/merchant-product-data.test.ts \
  src/app/products/'[slug]'/page.test.tsx \
  src/app/shop/page.test.tsx \
  src/app/banners/page.test.tsx \
  src/server/orders/order-pricing-snapshot.test.ts \
  src/server/payments/payment-service.test.ts \
  src/server/payments/stripe-provider.test.ts \
  src/server/payments/afterpay-provider.test.ts
```

Expected first run: FAIL only where a surface has not yet picked up the new product shape. If a failure shows that a production serializer or adapter is dropping the Bundle product key, market currency, or authoritative stored total, make the smallest corresponding change in the explicitly listed production file, then rerun this command until PASS.

- [ ] **Step 3: Commit Task 8**

```bash
git add src/domain/analytics/events.test.ts src/domain/catalogue/merchant-product-data.test.ts src/app/products/'[slug]'/page.test.tsx src/app/shop/page.test.tsx src/app/banners/page.test.tsx src/server/orders/order-pricing-snapshot.test.ts src/server/payments/payment-service.test.ts src/server/payments/stripe-provider.test.ts src/server/payments/afterpay-provider.test.ts
git commit -m "test: cover banner bundle commerce surfaces"
```

If Step 2 required one of the explicitly listed production files, add that file by its exact path. Before committing, inspect `git diff --cached --name-only` and unstage any file not directly related to these tests/fixes.

---

### Task 9: Run complete verification and browser acceptance

**Files:**
- Modify only files required by a concrete failing verification.
- Record screenshots under ignored `output/playwright/`.

**Interfaces:**
- Consumes the completed feature.
- Produces release evidence, not new application behavior.

- [ ] **Step 1: Run focused Bundle tests**

```bash
npm test -- --run \
  src/domain/catalogue/catalogue.test.ts \
  src/domain/configuration/schemas.test.ts \
  src/domain/catalogue/market-price-book.test.ts \
  src/domain/catalogue/product-registry.test.ts \
  src/domain/bundles/banner-bundle.test.ts \
  src/domain/checkout/reprice-cart.test.ts \
  src/domain/pricing/market-quote.test.ts \
  src/components/banner-bundle-configurator.test.tsx \
  src/domain/cart/browser-cart-repository.test.ts \
  src/server/shipping/shipping-service.test.ts
```

Expected: PASS with zero failures.

- [ ] **Step 2: Run static checks and executable non-database suite**

```bash
npm run typecheck
npm run lint
npm test -- --run --exclude '**/*.integration.test.ts' --exclude 'src/server/addresses/drizzle-address-repository.test.ts' --exclude 'src/server/checkout/drizzle-checkout-repository.test.ts'
```

Expected: all commands exit 0.

- [ ] **Step 3: Run production build with validation-only auth values**

```bash
BETTER_AUTH_URL=https://build.local.invalid \
BETTER_AUTH_SECRET=build-only-secret-with-32-characters \
npm run build
```

Expected: Next.js production build exits 0. Do not use or print production secrets.

- [ ] **Step 4: Run Playwright acceptance on `http://192.168.4.199:3000`**

At 390 px and desktop verify:

1. Shop → Banner Bundle → Configure.
2. Both size prices match NZ gross cents.
3. Roll-Up uploads one file while Wall Banner remains unchanged.
4. Wall Banner selects Send Later while Roll-Up remains Upload Now.
5. Add to Cart shows both component summaries.
6. Checkout reprices to the same total.
7. Sign out immediately clears the signed-in cart; a second identity does not see the Bundle item.
8. AU route shows A$339.99/A$469.99 AUD and fixed Standard Delivery.
9. No horizontal overflow, clipped upload controls, or detached error messages.

- [ ] **Step 5: Inspect the release boundary and commit any test-driven fixes**

```bash
git diff --check
git status --short
git log --oneline -10
```

Only product, pricing, Bundle upload/cart/order/shipping, migration, image, and test files may be included. Existing unrelated untracked audit files remain outside the release.

- [ ] **Step 6: Stop before production deployment**

Report exact test counts, build result, migration status, local browser results, commits, and any unavailable `TEST_DATABASE_URL` coverage. Do not deploy until the user explicitly requests production deployment.
