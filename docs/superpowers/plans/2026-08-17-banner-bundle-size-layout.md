# Banner Bundle Size Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current verified worktree. Do not delegate this small, shared-file change.

**Goal:** Match the approved Banner Bundle size-selector layout while preserving every existing size key, price, selection handler, accessible name, cart value and order value.

**Architecture:** Keep the existing Bundle radio group and authoritative `sizeChoices`. Add one display-only wall-banner dimension to each Bundle option, render a Bundle-specific header and stacked visible label, and isolate the new layout behind Bundle-only CSS classes so standard product cards are unchanged.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS Modules, Vitest, Testing Library

## Constraints

- Change only presentation in the Banner Bundle format selector.
- Keep the two size keys and their current checked/onChange behaviour.
- Keep the full radio accessible names, including `Roll Up Banner + ... Wall Banner` and the formatted market price.
- Keep all pricing calculations and NZD/AUD values unchanged.
- Keep cart, checkout, order summary, persistence and analytics labels unchanged.
- Do not change the shared standard-product size-card markup or styling.

---

### Task 1: Add a failing Bundle layout regression test

**Files:**
- Modify: `src/components/banner-bundle-configurator.test.tsx`

- [ ] **Step 1: Extend the focused size-selector test**

Inside the existing `simplifies Bundle size labels and omits GST only from size-card prices` test, scope assertions to the `Size` radiogroup and require the approved visible structure:

```tsx
const sizePicker = screen.getByRole("radiogroup", { name: "Size" });

expect(within(sizePicker).getByText("Roll Up Banner +")).toBeVisible();
expect(within(sizePicker).getAllByText("Wall Banner")).toHaveLength(2);
expect(within(sizePicker).getByText("200 x 100 cm")).toBeVisible();
expect(within(sizePicker).getByText("300 x 150 cm")).toBeVisible();
expect(within(sizePicker).getByText("From NZ$359.99")).toBeVisible();
expect(within(sizePicker).getByText("From NZ$489.99")).toBeVisible();
```

Retain the existing assertions proving:

```tsx
expect(screen.getByRole("radio", {
  name: "Roll Up Banner + 200 x 100 cm Wall Banner, From NZ$359.99",
})).toBeChecked();
expect(screen.getByRole("radio", {
  name: "Roll Up Banner + 300 x 150 cm Wall Banner, From NZ$489.99",
})).not.toBeChecked();
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm test -- src/components/banner-bundle-configurator.test.tsx
```

Expected: FAIL because `Roll Up Banner +`, `Wall Banner` and each dimension are not currently rendered as separate visible elements.

---

### Task 2: Implement the Bundle-only layout

**Files:**
- Modify: `src/components/banner-bundle-configurator.tsx`
- Modify: `src/components/storefront.module.css`

- [ ] **Step 1: Add display-only Bundle size metadata**

Keep `BANNER_BUNDLE_SIZE_OPTION_LABELS` as the full semantic/persisted label source and add a separate local map for the visible wall-banner dimension:

```tsx
const BANNER_BUNDLE_WALL_SIZE_LABELS: Record<string, string> = {
  "rollup-wall-200x100": "200 x 100 cm",
  "rollup-wall-300x150": "300 x 150 cm",
};
```

Extend each `sizeChoices` item with:

```tsx
wallBannerSize: BANNER_BUNDLE_WALL_SIZE_LABELS[option.key]
  ?? formatConfigurationSizeLabel(option),
```

Do not replace `option.label`; it remains the source for the full `aria-label` and all existing downstream semantics.

- [ ] **Step 2: Render the approved visual hierarchy**

Replace only the Bundle selector's visible markup with this structure:

```tsx
<fieldset
  className={`${styles.sizePicker} ${styles.bundleSizePicker}`}
  role="radiogroup"
>
  <legend className="sr-only">Size</legend>
  <div className={styles.bundleSizeHeader} aria-hidden="true">
    <span>Size</span>
    <strong>Roll Up Banner +</strong>
  </div>
  <div className={styles.sizeOptions}>
    {sizeChoices.map((option) => {
      const priceLabel = `From ${formatMarketMoney(
        option.minimumPriceInclTaxCents,
        currency,
      )}`;
      return (
        <label className={styles.sizeOption} key={option.key}>
          <input
            type="radio"
            name="size"
            value={option.key}
            checked={sizeKey === option.key}
            onChange={() => setSizeKey(option.key)}
            aria-label={`${option.label}, ${priceLabel}`}
          />
          <span className={`${styles.sizeOptionBody} ${styles.bundleSizeOptionBody}`}>
            <span className={styles.bundleSizeDescription}>
              <strong>Wall Banner</strong>
              <small>{option.wallBannerSize}</small>
            </span>
            <span>{priceLabel}</span>
          </span>
        </label>
      );
    })}
  </div>
</fieldset>
```

The visually hidden legend preserves the radiogroup name. `aria-hidden` on the visual header prevents duplicated screen-reader wording.

- [ ] **Step 3: Add isolated responsive CSS**

Add Bundle-only classes next to the existing size-card styles:

```css
.bundleSizeHeader {
  display: grid;
  grid-template-columns: 5.5rem minmax(0, 1fr);
  gap: 0.5rem;
  align-items: end;
  margin-bottom: 0.45rem;
  color: var(--ink);
}

.bundleSizeHeader span,
.bundleSizeHeader strong {
  font-size: 0.875rem;
  font-weight: 750;
  line-height: 1.35;
}

.bundleSizeOptionBody {
  padding-inline: 3rem 1.5rem;
}

.bundleSizeOptionBody > .bundleSizeDescription {
  display: grid;
  gap: 0.15rem;
  color: var(--ink);
  text-align: left;
  white-space: normal;
}

.bundleSizeDescription small {
  font-size: 0.78rem;
  font-weight: 500;
  line-height: 1.3;
}
```

Add a `max-width: 520px` override that reduces the header first column and card padding while keeping the price on one line:

```css
@media (max-width: 520px) {
  .bundleSizeHeader {
    grid-template-columns: 4.5rem minmax(0, 1fr);
  }

  .bundleSizeOptionBody {
    gap: 0.75rem;
    padding-inline: 1rem;
  }

  .bundleSizeOptionBody > span:last-child {
    font-size: 0.8rem;
  }
}
```

If the actual 390 px browser check shows wrapping or overflow, adjust only these Bundle-specific spacing values. Do not alter the shared `.sizeOptionBody` rules.

- [ ] **Step 4: Run focused GREEN verification**

Run:

```bash
npm test -- src/components/banner-bundle-configurator.test.tsx src/components/product-configurator.test.tsx
npm run typecheck
npx eslint src/components/banner-bundle-configurator.tsx src/components/banner-bundle-configurator.test.tsx
git diff --check
```

Expected: all commands PASS; the standard configurator test remains unchanged and green.

---

### Task 3: Verify the rendered layout and release boundary

**Files:**
- No additional source files expected.

- [ ] **Step 1: Run a production build**

Run with the repository's existing safe build environment:

```bash
npm run build
```

Expected: PASS without changing generated or environment files.

- [ ] **Step 2: Check the real local page at desktop and 390 px**

Open the Banner Bundle product page at `http://192.168.4.199:3000` and verify:

- `Size` and `Roll Up Banner +` form the header row;
- each card shows `Wall Banner`, then its dimension;
- each price stays right aligned on one line;
- the selected green border still changes when the second option is selected;
- no horizontal overflow occurs at 390 px;
- the order-summary price/size updates exactly as before.

- [ ] **Step 3: Commit only the approved UI change**

```bash
git add src/components/banner-bundle-configurator.tsx src/components/banner-bundle-configurator.test.tsx src/components/storefront.module.css
git diff --cached --check
git commit -m "fix: refine banner bundle size layout"
```

- [ ] **Step 4: Deploy and verify the exact Ready artifact**

Push the exact commit, wait for its Vercel deployment to become Ready, promote that same artifact, then verify the public Banner Bundle route at desktop and 390 px. Do not include unrelated files or another branch in the release boundary.
