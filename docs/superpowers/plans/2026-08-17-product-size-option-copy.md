# Product Size Option Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify product configuration size cards while preserving all prices, tax calculations, stored size labels, and GST wording outside those cards.

**Architecture:** Keep authoritative configuration schemas and persisted labels unchanged. Apply display-only copy at the two existing configurator render boundaries: standard products remove the tax suffix from the size-card price, while Banner Bundle also maps its two fixed size keys to the approved customer-facing labels.

**Tech Stack:** Next.js App Router, React, TypeScript, Vitest, Testing Library.

## Global Constraints

- Remove `incl GST` only from the price inside product configuration size option cards.
- Keep all GST wording outside those size option cards unchanged.
- Display `Roll Up Banner + 200 x 100 cm Wall Banner` and `Roll Up Banner + 300 x 150 cm Wall Banner` in Banner Bundle size cards.
- Do not change product prices, tax calculations, internal size keys, configuration schemas, cart data, checkout data, or stored order labels.

---

### Task 1: Update Product Configuration Size Cards

**Files:**
- Modify: `src/components/product-configurator.test.tsx`
- Modify: `src/components/product-configurator.tsx`
- Modify: `src/components/banner-bundle-configurator.test.tsx`
- Modify: `src/components/banner-bundle-configurator.tsx`

**Interfaces:**
- Consumes: existing `sizeChoices`, `formatMarketMoney`, `option.key`, and stored schema labels.
- Produces: display-only radio labels and visible size-card copy; no exported interface or persisted data changes.

- [ ] **Step 1: Write the failing standard-product test**

Change the default configuration assertion so the size-card radio name excludes `incl GST`, while retaining the existing order-summary GST assertions:

```tsx
expect(screen.getByRole("radio", {
  name: /^A4.*From NZ\$120\.75$/,
})).toBeChecked();
expect(screen.queryByRole("radio", {
  name: /From NZ\$120\.75 incl GST/,
})).not.toBeInTheDocument();

const orderSummary = screen.getByRole("complementary", { name: "Order summary" });
expect(within(orderSummary).getByText("NZ$74.75 incl GST")).toBeInTheDocument();
expect(within(orderSummary).getByText("NZ$46.00 incl GST")).toBeInTheDocument();
```

- [ ] **Step 2: Write the failing Banner Bundle test**

Add a focused test that asserts both approved labels, prices without the suffix, and continued GST wording in the order summary:

```tsx
it("simplifies Bundle size labels and omits GST only from size-card prices", () => {
  render(
    <BannerBundleConfigurator
      product={product}
      schema={schema}
      registry={defaultProductRegistry}
      pricing={defaultProductRegistry.pricing}
      orderDate="2026-08-17"
    />,
  );

  expect(screen.getByRole("radio", {
    name: "Roll Up Banner + 200 x 100 cm Wall Banner, From NZ$359.99",
  })).toBeChecked();
  expect(screen.getByRole("radio", {
    name: "Roll Up Banner + 300 x 150 cm Wall Banner, From NZ$489.99",
  })).not.toBeChecked();
  expect(screen.queryByRole("radio", { name: /85 × 200 cm Roll-Up/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("radio", { name: /incl GST/ })).not.toBeInTheDocument();

  const orderSummary = screen.getByRole("complementary", { name: "Order summary" });
  expect(within(orderSummary).getByText("NZ$359.99 incl GST")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run focused tests to verify RED**

Run:

```bash
npm test -- --run src/components/product-configurator.test.tsx src/components/banner-bundle-configurator.test.tsx
```

Expected: failures show the existing size-card prices still include `incl GST` and Banner Bundle still exposes the full `85 × 200 cm Roll-Up` labels.

- [ ] **Step 4: Implement the standard-product display change**

In `src/components/product-configurator.tsx`, build the size-card price without `taxSuffix`:

```tsx
const priceLabel = `From ${formatMarketMoney(
  option.minimumPriceInclTaxCents,
  currency,
)}`;
```

Leave all other `taxSuffix` uses unchanged.

- [ ] **Step 5: Implement Banner Bundle display-only labels**

In `src/components/banner-bundle-configurator.tsx`, map only the two size-card labels:

```tsx
const BANNER_BUNDLE_SIZE_OPTION_LABELS: Record<string, string> = {
  "rollup-wall-200x100": "Roll Up Banner + 200 x 100 cm Wall Banner",
  "rollup-wall-300x150": "Roll Up Banner + 300 x 150 cm Wall Banner",
};
```

Use the display label in `sizeChoices` while retaining the schema label for `sizeLabel` and persisted cart/order data:

```tsx
label: BANNER_BUNDLE_SIZE_OPTION_LABELS[option.key]
  ?? formatConfigurationSizeLabel(option),
```

Build the Bundle size-card price without `taxSuffix`:

```tsx
const priceLabel = `From ${formatMarketMoney(
  option.minimumPriceInclTaxCents,
  currency,
)}`;
```

- [ ] **Step 6: Run focused tests to verify GREEN**

Run:

```bash
npm test -- --run src/components/product-configurator.test.tsx src/components/banner-bundle-configurator.test.tsx
```

Expected: both files and all contained tests pass.

- [ ] **Step 7: Run static and production verification**

Run:

```bash
npm run typecheck
npx eslint src/components/product-configurator.tsx src/components/product-configurator.test.tsx src/components/banner-bundle-configurator.tsx src/components/banner-bundle-configurator.test.tsx
DATABASE_URL='postgresql://build:build@127.0.0.1:1/rnr_build' BETTER_AUTH_SECRET='build-only-not-secret-value-1234567890' BETTER_AUTH_URL='https://build.invalid' VERCEL_ENV='production' npm run build
git diff --check
```

Expected: all commands exit zero and the production build generates all routes successfully.

- [ ] **Step 8: Commit the implementation**

```bash
git add src/components/product-configurator.tsx src/components/product-configurator.test.tsx src/components/banner-bundle-configurator.tsx src/components/banner-bundle-configurator.test.tsx
git commit -m "fix: simplify product size option copy"
```

