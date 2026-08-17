# Banner Bundle Summary Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Roll Up Banner dimensions from the two customer-facing Bundle summary rows without changing persisted cart or order specifications.

**Architecture:** Derive one presentation-only label from the existing approved Bundle size-label map. Continue using the authoritative schema label for the cart item, while the artwork preview and order summary use the shorter display label.

**Tech Stack:** Next.js App Router, React, TypeScript, Vitest, Testing Library

## Global Constraints

- Small visible label: `Roll Up Banner + 200 x 100 cm Wall Banner`.
- Large visible label: `Roll Up Banner + 300 x 150 cm Wall Banner`.
- Keep authoritative size keys and complete persisted configuration labels unchanged.
- Keep prices, selection behaviour, cart, checkout, order, admin data, and CSS unchanged.

---

### Task 1: Separate visible and persisted Bundle size labels

**Files:**
- Modify: `src/components/banner-bundle-configurator.test.tsx`
- Modify: `src/components/banner-bundle-configurator.tsx`

**Interfaces:**
- Consumes: `BANNER_BUNDLE_SIZE_OPTION_LABELS` and `formatConfigurationSizeLabel(size)`.
- Produces: local `displaySizeLabel: string` for render-only use; persisted `sizeLabel: string` remains unchanged.

- [ ] **Step 1: Write the failing regression test**

Add assertions to the existing Bundle label test:

```tsx
const artworkPreview = screen.getByRole("region", { name: "Artwork preview" });
expect(within(artworkPreview).getByText(
  "Roll Up Banner + 200 x 100 cm Wall Banner",
)).toBeVisible();
expect(within(artworkPreview).queryByText(/85 × 200 cm Roll-Up/))
  .not.toBeInTheDocument();

const orderSummary = screen.getByRole("complementary", { name: "Order summary" });
expect(within(orderSummary).getByText(
  "Roll Up Banner + 200 x 100 cm Wall Banner",
)).toBeVisible();
```

Add this assertion to the existing add-to-cart test:

```tsx
expect(stored.items[0].sizeLabel)
  .toBe("85 × 200 cm Roll-Up + 200 × 100 cm Wall Banner");
```

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```bash
npm test -- --run src/components/banner-bundle-configurator.test.tsx
```

Expected: the visible-label assertions fail because both summary rows still render the complete schema label; the persistence assertion passes.

- [ ] **Step 3: Implement the presentation-only label**

Immediately after the existing `sizeLabel` declaration, add:

```ts
const displaySizeLabel = BANNER_BUNDLE_SIZE_OPTION_LABELS[size.key] ?? sizeLabel;
```

Use `displaySizeLabel` only in the artwork preview `Format` value and order summary `Size` value. Leave the cart item `sizeLabel` property unchanged.

- [ ] **Step 4: Run focused and release verification**

Run:

```bash
npm test -- --run src/components/banner-bundle-configurator.test.tsx
npm run typecheck
npx eslint src/components/banner-bundle-configurator.tsx src/components/banner-bundle-configurator.test.tsx
npm run build
```

Expected: every command exits 0.

- [ ] **Step 5: Commit the scoped fix**

```bash
git add src/components/banner-bundle-configurator.tsx src/components/banner-bundle-configurator.test.tsx
git commit -m "fix: shorten banner bundle summary label"
```
