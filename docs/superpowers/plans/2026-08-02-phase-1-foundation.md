# R&R Next Platform Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a standalone, tested Next.js storefront foundation with the approved R&R catalogue, authoritative pricing domain, new editorial visual shell and responsive discovery pages.

**Architecture:** Next.js App Router renders typed local catalogue repositories through Server Components. Framework-independent TypeScript modules own all money and pricing rules; React only formats returned values. Phase 1 has no database, checkout, payment, private upload or WordPress runtime dependency.

**Tech Stack:** Current stable Next.js App Router, React, TypeScript, CSS Modules/global CSS, Vitest, React Testing Library, jsdom, ESLint and Playwright browser verification.

## Global Constraints

- Work only in `/Users/ronnieli/Documents/海报制作/rnr-next-platform`.
- Do not modify `/Users/ronnieli/Documents/海报制作/rnr-wordpress-staging`.
- Node.js must be at least 20.9; the verified host version is 24.18.1.
- Store money as integer NZD cents and calculate GST server-side.
- Copy selected approved image files into the new project; do not reference WordPress URLs at runtime.
- Minimum supported viewport is 390px.
- No database, authentication, cart, checkout, payment or upload implementation is included in phase 1.

---

### Task 1: Next.js scaffold and test harness

**Files:**
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `src/app/layout.tsx`, `src/app/page.tsx`
- Create: `vitest.config.mts`, `vitest.setup.ts`, `src/app/page.test.tsx`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `npm run dev`, `npm run build`, `npm run lint`, `npm run typecheck`, `npm run test:run`.

- [ ] **Step 1: Generate the isolated application**

Run from the parent directory:

```bash
npx create-next-app@latest rnr-next-platform-tmp --ts --eslint --app --src-dir --use-npm --import-alias '@/*' --no-tailwind
```

Copy generated application files into the already initialized repository, excluding `.git`, then remove the temporary directory.

- [ ] **Step 2: Install the official Next.js Vitest toolchain**

Run:

```bash
npm install --save-dev vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom @testing-library/jest-dom vite-tsconfig-paths
```

- [ ] **Step 3: Write the failing homepage smoke test**

Create `src/app/page.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HomePage from './page';

describe('HomePage', () => {
  it('introduces R&R Gallery as custom artwork', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1, name: /art made from your story/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the test and verify RED**

Run: `npm run test:run -- src/app/page.test.tsx`

Expected: FAIL because the generated page does not contain the approved heading.

- [ ] **Step 5: Add Vitest configuration and the minimal heading**

Configure jsdom, React and `@/*` path aliases in `vitest.config.mts`; load `@testing-library/jest-dom/vitest` in `vitest.setup.ts`; add `test:run` and `typecheck` scripts; replace the generated page with a semantic `<main><h1>Art made from your story.</h1></main>`.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```bash
npm run test:run
npm run lint
npm run typecheck
```

Expected: all commands pass without warnings.

Commit: `chore: scaffold standalone Next platform`

### Task 2: Money and pricing domain

**Files:**
- Create: `src/domain/money.ts`
- Create: `src/domain/pricing/types.ts`
- Create: `src/domain/pricing/people-fees.ts`
- Create: `src/domain/pricing/calculate-canvas.ts`
- Create: `src/domain/pricing/calculate-fixed-package.ts`
- Test: `src/domain/pricing/pricing.test.ts`

**Interfaces:**
- Produces: `formatNzd(cents: number): string`.
- Produces: `calculateDigitalOilCanvas(input: { baseExGstCents: number; peoplePets: number }): PriceBreakdown`.
- Produces: `calculateFixedPackage(input: { priceExGstCents: number }): PriceBreakdown`.
- `PriceBreakdown` contains `lines`, `subtotalExGstCents`, `gstCents`, `totalInclGstCents`.

- [ ] **Step 1: Write failing approved-vector tests**

Test that A4 plus one person returns `10500`, `1575`, `12075`; A4 plus two returns `12500`, `1875`, `14375`; six people uses `13000 + 2500`; Roll-Up returns `23000`, `3450`, `26450`; zero people throws `InvalidPricingInputError`; and `formatNzd(12075)` returns `$120.75`.

- [ ] **Step 2: Run and verify RED**

Run: `npm run test:run -- src/domain/pricing/pricing.test.ts`

Expected: FAIL because the pricing modules do not exist.

- [ ] **Step 3: Implement minimal integer-cent pricing**

Use the 15 percent GST formula `Math.round(subtotalExGstCents * 15 / 100)`. Return frozen line items and totals. Reject non-integer cents and people counts below one.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm run test:run -- src/domain/pricing/pricing.test.ts`

Expected: all pricing vectors pass.

Commit: `feat: add authoritative pricing domain`

### Task 3: Typed catalogue and copied media

**Files:**
- Create: `src/domain/catalogue/types.ts`
- Create: `src/domain/catalogue/products.ts`
- Create: `src/domain/catalogue/catalogue.test.ts`
- Create: `public/media/home/family-canvas.webp`
- Create: `public/media/home/digital-oil-pet.webp`
- Create: `public/media/home/roll-up-banner.webp`
- Create: `public/media/home/wall-banner.webp`

**Interfaces:**
- Produces: `products: readonly Product[]`.
- Produces: `getProductBySlug(slug: string): Product | undefined`.
- Produces: `getProductsByCategory(category: 'canvas' | 'banners'): readonly Product[]`.

- [ ] **Step 1: Write failing catalogue tests**

Assert there are exactly seven unique active products, required slugs resolve, all media paths begin `/media/`, all starting prices are positive integers, Canvas returns three products and Banners returns four.

- [ ] **Step 2: Run and verify RED**

Run: `npm run test:run -- src/domain/catalogue/catalogue.test.ts`

Expected: FAIL because catalogue modules do not exist.

- [ ] **Step 3: Implement the product repository**

Define stable product keys, slugs, category, workflow key, title, summary, image, image alt, starting price ex GST and featured flag for the seven approved products.

- [ ] **Step 4: Copy approved media**

Copy these source files without modifying them:

```text
../rnr-wordpress-staging/wp-content/themes/rnr-astra-child/assets/images/homepage/homepage-canvas-family-1240.webp
../rnr-wordpress-staging/wp-content/themes/rnr-astra-child/assets/images/homepage/homepage-digital-oil-pet-1619.webp
../rnr-wordpress-staging/wp-content/themes/rnr-astra-child/assets/images/homepage/homepage-roll-up-banner-1122.webp
../rnr-wordpress-staging/wp-content/themes/rnr-astra-child/assets/images/homepage/homepage-wall-banner-1122.webp
```

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm run test:run -- src/domain/catalogue/catalogue.test.ts`

Commit: `feat: add typed R&R catalogue and media`

### Task 4: Global visual shell

**Files:**
- Create: `src/components/site-header.tsx`
- Create: `src/components/site-footer.tsx`
- Create: `src/components/brand-mark.tsx`
- Create: `src/components/site-shell.test.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: `SiteHeader`, `SiteFooter`, `BrandMark` components.
- Consumes: only Next.js `Link`, React and CSS classes.

- [ ] **Step 1: Write failing semantic shell tests**

Render header and footer. Assert the R&R home link, primary navigation links, cart link, mobile menu accessible name, phone link, email link and privacy link exist.

- [ ] **Step 2: Run and verify RED**

Run: `npm run test:run -- src/components/site-shell.test.tsx`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement accessible shell**

Use a native `<details>` mobile menu, semantic `<nav>`, visible focus states and a 44px minimum target. Use CSS custom properties for ivory, ink, gallery green, aged gold, border, spacing and type scale. Do not use gradients or decorative animation.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm run test:run -- src/components/site-shell.test.tsx`

Commit: `feat: establish editorial gallery shell`

### Task 5: Homepage and discovery pages

**Files:**
- Create: `src/components/product-card.tsx`
- Create: `src/components/product-story.tsx`
- Create: `src/components/product-card.test.tsx`
- Modify: `src/app/page.tsx`
- Create: `src/app/shop/page.tsx`
- Create: `src/app/canvas/page.tsx`
- Create: `src/app/banners/page.tsx`
- Create: `src/app/products/[slug]/page.tsx`
- Create: `src/app/design-gallery/page.tsx`
- Create: `src/app/privacy/page.tsx`
- Create: `src/app/terms/page.tsx`
- Create: `src/app/not-found.tsx`

**Interfaces:**
- Produces: `ProductCard({ product }: { product: Product })`.
- Produces: `ProductStory({ product, eyebrow, ctaLabel, mediaFirst? })`.
- Consumes catalogue repository functions from Task 3 and `formatNzd` from Task 2.

- [ ] **Step 1: Write failing product-card behavior tests**

Assert a card exposes a product heading, descriptive image alt, a link to `/products/<slug>` and copy beginning `From $` based on ex-GST starting price.

- [ ] **Step 2: Run and verify RED**

Run: `npm run test:run -- src/components/product-card.test.tsx`

Expected: FAIL because `ProductCard` does not exist.

- [ ] **Step 3: Implement product card and story components**

Use semantic article markup and `next/image`. Keep one primary link per card and avoid nested interactive elements.

- [ ] **Step 4: Build routes from typed content**

Homepage section order: hero, Digital Oil Painting Canvas, Roll-Up Banner, Wall Banner, selected work, three-step process and final CTA. Shop and category pages render repository results. Product routes use `generateStaticParams` and `notFound()`. Legal pages use approved non-placeholder business copy.

- [ ] **Step 5: Verify unit tests, lint, types and production build**

Run:

```bash
npm run test:run
npm run lint
npm run typecheck
npm run build
```

Expected: all commands pass without warnings.

Commit: `feat: build phase one storefront discovery`

### Task 6: Browser and responsive acceptance

**Files:**
- Create: `docs/audits/phase-1-browser-2026-08-02/README.md`
- Create: responsive screenshots under `docs/audits/phase-1-browser-2026-08-02/`

**Interfaces:**
- Consumes the production Next.js build.
- Produces an evidence matrix for 390, 430, 768, 922, 1180, 1440 and 1920 pixels.

- [ ] **Step 1: Start the verified local application**

Run: `npm run dev`

- [ ] **Step 2: Inspect routes in a real browser**

Check `/`, `/shop`, `/canvas`, `/banners`, one product route, `/design-gallery`, `/privacy`, `/terms` and an invalid URL.

- [ ] **Step 3: Validate responsive and keyboard behavior**

At every required width confirm no horizontal overflow, clipping or overlap. Open and close the mobile menu with keyboard, follow focus order, inspect primary CTA visibility and confirm all images load.

- [ ] **Step 4: Record evidence and run final verification**

Run:

```bash
npm run test:run
npm run lint
npm run typecheck
npm run build
git diff --check
git status --short
```

Commit: `test: verify phase one storefront experience`

