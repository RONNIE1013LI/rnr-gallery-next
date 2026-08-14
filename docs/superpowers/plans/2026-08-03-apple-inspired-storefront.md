# Apple-Inspired Storefront Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Present the supplied Digital Oil Painting Canvas hero image and make the homepage and product browsing/configuration surfaces feel calmer, clearer, and more premium while retaining every existing commerce behaviour.

**Architecture:** Keep the current Next.js routes and reusable storefront components. Add the supplied WebP asset under the homepage media directory, change only the homepage component's hero source, and refine the existing global/storefront CSS tokens and component selectors rather than introducing a second design system.

**Tech Stack:** Next.js App Router, React, TypeScript, CSS Modules, Vitest, Testing Library.

## Global Constraints

- Preserve current cart, checkout, upload, urgent-service, pricing, authentication, order and payment behaviour.
- Keep the existing R&R colour tokens as brand accents; do not import a third-party design system or dependency.
- Use the supplied `/Users/ronnieli/Documents/digital-oil-painting-canvas-hero-landscape-01.webp` as the homepage hero asset.
- Use system San Francisco-compatible typography: `-apple-system`, `BlinkMacSystemFont`, `SF Pro Display`, and `SF Pro Text` fallbacks.
- Preserve 320 px minimum-width support and verify 390, 768, 1024, 1440, and 1920 px viewports.
- Do not commit, reset, stash, revert, clean, delete existing work, or modify payment/order business logic.

---

### Task 1: Add and verify the homepage hero asset

**Files:**
- Create: `public/media/home/digital-oil-painting-canvas-hero-landscape-01.webp`
- Modify: `src/app/page.tsx:28-35`
- Create: `src/app/page.test.tsx`

**Interfaces:**
- Consumes: the supplied 3840 × 2160 WebP source image.
- Produces: the homepage hero image with R&R-specific alt text and responsive `sizes` metadata.

- [ ] **Step 1: Write the failing homepage test**

```tsx
expect(screen.getByRole("img", {
  name: "Digital oil painting canvas displayed in a warm home interior",
})).toHaveAttribute(
  "src",
  expect.stringContaining("digital-oil-painting-canvas-hero-landscape-01.webp"),
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/app/page.test.tsx`
Expected: FAIL because the homepage still references `family-canvas.webp`.

- [ ] **Step 3: Copy the supplied non-destructively and update the homepage image**

```tsx
<Image
  src="/media/home/digital-oil-painting-canvas-hero-landscape-01.webp"
  alt="Digital oil painting canvas displayed in a warm home interior"
  fill
  priority
  sizes="(max-width: 820px) 100vw, 60vw"
/>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/app/page.test.tsx`
Expected: PASS.

### Task 2: Apply the Apple-inspired typography and spacing foundations

**Files:**
- Modify: `src/app/globals.css:1-150`
- Modify: `src/components/storefront.module.css:703-1155,2570-2750`

**Interfaces:**
- Consumes: existing R&R colour and layout tokens.
- Produces: global font families, a calmer heading scale, consistent action geometry, and responsive section density.

- [ ] **Step 1: Implement minimal visual refinements**

```css
:root {
  --font-display: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Avenir Next", sans-serif;
  --font-body: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Avenir Next", sans-serif;
}
```

Use existing selectors to reduce decorative contrast, make headings use tighter Apple-like tracking/line-height, keep primary CTA geometry consistent, and avoid new gradients, glass effects, or animation.

- [ ] **Step 2: Run type and lint checks**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

### Task 3: Refine product detail and configuration hierarchy

**Files:**
- Modify: `src/components/storefront.module.css:1081-1710,2570-2750`
- Test: `src/components/product-configurator.test.tsx`

**Interfaces:**
- Consumes: existing product detail markup and `ProductConfigurator` labels/actions.
- Produces: clearer price/CTA prominence, quieter checklists, predictable form controls, and mobile-safe configuration spacing without changing behaviour.

- [ ] **Step 1: Refine only CSS presentation**

```css
.productDetailInner { gap: clamp(2rem, 5vw, 5rem); }
.productDetailPrice { font-size: 1.1rem; }
.configuratorStep { border-radius: 1.25rem; }
```

Keep current form control names, DOM semantics, quote values, and responsive breakpoint strategy. Use the existing `820px` mobile single-column breakpoint and reduce only mobile padding where needed.

- [ ] **Step 2: Run product tests**

Run: `npm run test:run -- src/components/product-configurator.test.tsx src/components/product-card.test.tsx`
Expected: PASS.

### Task 4: Browser acceptance and regression checks

**Files:**
- Modify: `docs/audits/apple-inspired-storefront-2026-08-03.md`

**Interfaces:**
- Consumes: local development server at `http://localhost:3000`.
- Produces: evidence of no overflow, overlap, missing image, or inaccessible primary CTA.

- [ ] **Step 1: Capture the homepage and Digital Oil Painting Canvas product page**

Run a local Playwright browser check at 390, 768, 1024, 1440, and 1920 px.

- [ ] **Step 2: Verify each viewport**

```ts
expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
expect(page.getByRole("link", { name: "Create your artwork" })).toBeVisible();
```

- [ ] **Step 3: Record only confirmed results**

Document viewport outcomes, console errors/warnings, and known environment limits in `docs/audits/apple-inspired-storefront-2026-08-03.md`.

- [ ] **Step 4: Run final static checks**

Run: `npm run test:run -- src/app/page.test.tsx src/components/product-configurator.test.tsx src/components/product-card.test.tsx && npm run typecheck && npm run lint && git diff --check`
Expected: PASS.
