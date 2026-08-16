# Design Detail Size Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render design-detail sizes as an orderly responsive list and rename the primary CTA without changing its destination.

**Architecture:** Keep product registry labels as the only size-data source. Change the design detail page from one joined text node to semantic list markup, and add narrowly scoped CSS for a two-column desktop layout that collapses to one column at the existing mobile breakpoint.

**Tech Stack:** Next.js App Router, React 19, CSS Modules, Vitest, Testing Library.

## Global Constraints

- Do not change product size data, prices, markets, cart, checkout, payment, or configurator logic.
- Preserve registry order and the existing configurator URL including the design ID.
- Desktop uses two columns; mobile uses one column; each complete size label stays together.
- The primary CTA text is exactly `Start With Your Photos`.
- Do not add dependencies.

---

### Task 1: Design detail size list and CTA

**Files:**
- Modify: `src/app/designs/[slug]/page.test.tsx`
- Modify: `src/app/designs/[slug]/page.tsx`
- Modify: `src/components/storefront.module.css`

**Interfaces:**
- Consumes: `registryProduct.configuration.sizes: Array<{ key: string; label: string }>` and the existing design configurator URL.
- Produces: an accessible `ul` labelled `Available sizes`, one `li` per registry size, and the renamed CTA.

- [ ] **Step 1: Write failing behavior tests**

Add a test that renders a canvas design detail page and asserts that the `Available sizes` list contains these five literal items in registry order:

```ts
[
  "A4 — 29.7 × 21 cm",
  "A3 — 42 × 29.7 cm",
  "A2 — 59.4 × 42 cm",
  "A1 — 84.1 × 59.4 cm",
  "A0 — 118.9 × 84.1 cm",
]
```

Update the existing configurator-link assertion to find `Start With Your Photos` and verify its existing literal destination.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run test:run -- 'src/app/designs/[slug]/page.test.tsx'
```

Expected: FAIL because there is no labelled size list and the old CTA still reads `Use This Design`.

- [ ] **Step 3: Implement the minimal page markup**

Replace the joined size string with:

```tsx
<ul className={styles.designDetailSizeList} aria-label="Available sizes">
  {registryProduct.configuration.sizes.map((size) => (
    <li key={size.key}>{size.label}</li>
  ))}
</ul>
```

Change only the CTA text to `Start With Your Photos`; keep its `href` unchanged.

- [ ] **Step 4: Add the responsive presentation**

Add `.designDetailSizeList` styles that reset list spacing, use two equal grid columns, preserve each item with `white-space: nowrap`, and use a small consistent row and column gap. In the existing `@media (max-width: 820px)` rule, switch the list to one column.

- [ ] **Step 5: Run focused and static verification**

Run:

```bash
npm run test:run -- 'src/app/designs/[slug]/page.test.tsx'
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit successfully.

- [ ] **Step 6: Verify responsive layout locally**

At `http://192.168.4.199:3000`, open a canvas design detail at desktop width and 390 px width. Confirm desktop has two columns, mobile has one column, complete size labels do not split, the CTA copy is correct, and there is no horizontal overflow.

- [ ] **Step 7: Commit the implementation**

```bash
git add 'src/app/designs/[slug]/page.test.tsx' 'src/app/designs/[slug]/page.tsx' src/components/storefront.module.css
git commit -m "fix: tidy design detail size layout"
```
