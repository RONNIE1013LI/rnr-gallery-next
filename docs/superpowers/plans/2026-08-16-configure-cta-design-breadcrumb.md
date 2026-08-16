# Configure CTA and Design Breadcrumb Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the redundant configuration-page CTA and remove the visible design-detail breadcrumb while retaining its SEO structured data.

**Architecture:** Keep the existing page components and shared storefront stylesheet. Remove only the visible design-detail navigation and its private CSS hooks; retain the current design URL, `View Similar Designs`, structured-data breadcrumb, configurator form, pricing, uploads, cart, and checkout behavior.

**Tech Stack:** Next.js App Router, React 19, CSS Modules, Vitest, Testing Library.

## Global Constraints

- Remove the `Start Customising` link from the configuration-page introduction.
- Preserve the `#customise` form anchor and all configuration behavior.
- No visible breadcrumb navigation on design detail pages at any viewport size.
- Do not render `Design image` or its pixel dimensions in the customer-facing facts list.
- Preserve the existing three-level Breadcrumb JSON-LD.
- Do not change pricing, uploads, cart, checkout, payment, design URLs, metadata, or Gallery filters.

---

### Task 1: Remove the redundant configuration introduction CTA

**Files:**
- Modify: `src/app/products/[slug]/configure/page.test.tsx`
- Modify: `src/app/products/[slug]/configure/page-content.tsx`
- Modify: `src/components/storefront.module.css`

**Interfaces:**
- Consumes: existing `ConfigurePageContent` props and `form#customise` rendered by `ProductConfigurator`.
- Produces: unchanged configuration form with no introductory `Start Customising` link.

- [ ] **Step 1: Update the focused test to require the CTA to be absent**

```tsx
expect(screen.queryByRole("link", { name: "Start Customising" }))
  .not.toBeInTheDocument();
expect(document.querySelector("form#customise")).not.toBeNull();
expect(screen.getByText("Upload Photos Now")).toBeVisible();
expect(screen.getByText("Send Photos After Ordering")).toBeVisible();
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
npm test -- --run 'src/app/products/[slug]/configure/page.test.tsx'
```

Expected: FAIL because `Start Customising` is still present.

- [ ] **Step 3: Remove only the introductory link and its obsolete paragraph-specific CSS**

Delete this JSX from `ConfigurePageContent`:

```tsx
<a className={styles.primaryButton} href="#customise">Start Customising</a>
```

Remove `.configureIntro > p:last-child` because the last paragraph becomes the product summary and already follows the shared introductory typography.

- [ ] **Step 4: Re-run the focused test**

Run:

```bash
npm test -- --run 'src/app/products/[slug]/configure/page.test.tsx'
```

Expected: PASS.

### Task 2: Remove the visible design-detail breadcrumb

**Files:**
- Modify: `src/app/designs/[slug]/page.test.tsx`
- Modify: `src/app/designs/[slug]/page.tsx`
- Modify: `src/components/storefront.module.css`

**Interfaces:**
- Consumes: `title`, `/`, `/design-gallery`, and existing `buildBreadcrumbData()` JSON-LD.
- Produces: no visible breadcrumb navigation while leaving `rnr-design-breadcrumbs` unchanged.

- [ ] **Step 1: Update the focused test to require no visible breadcrumb**

```tsx
expect(screen.queryByRole("navigation", { name: "Breadcrumb" }))
  .not.toBeInTheDocument();
```

Keep the existing JSON-LD assertion requiring `Home`, `Design Gallery`, and the current design.

- [ ] **Step 2: Run the design-detail test and confirm it fails**

Run:

```bash
npm test -- --run 'src/app/designs/[slug]/page.test.tsx'
```

Expected: FAIL because the visible breadcrumb navigation still exists.

- [ ] **Step 3: Delete only the visible breadcrumb markup**

Remove the `<nav aria-label="Breadcrumb">...</nav>` block from the design detail page. Keep `<StructuredData id="rnr-design-breadcrumbs">` unchanged.

- [ ] **Step 4: Remove CSS hooks used only by the deleted markup**

Delete `.breadcrumbCurrent`, `.breadcrumbBackIcon`, and the mobile rules for `.breadcrumbHome`, `.breadcrumbSeparator`, `.breadcrumbCurrent`, `.breadcrumbGallery`, and `.breadcrumbBackIcon`. Keep `.publicBreadcrumbs` because `src/components/ad-landing-page.tsx` still consumes it.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- --run 'src/app/designs/[slug]/page.test.tsx' 'src/app/products/[slug]/configure/page.test.tsx'
```

Expected: PASS.

- [ ] **Step 6: Run repository verification**

Run:

```bash
npm run typecheck
npm run lint
set -a; source .env.local; set +a; npm test -- --run
set -a; source .vercel/.env.production.local; set +a; \
  BETTER_AUTH_URL='https://rrgallery.co.nz' \
  BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
  npm run build
```

Expected: TypeScript, ESLint, all tests, and production build pass. The build-only auth value is supplied only to the process and is never stored or committed.

- [ ] **Step 7: Verify responsive rendering and deploy the exact commit**

Check one public design detail at approximately 390px and desktop width. Confirm neither viewport shows a visible breadcrumb, `View Similar Designs` still exists, and the configuration page still has no introductory CTA. Commit only the scoped files, deploy a clean candidate from the exact commit, smoke-test it, then promote that same deployment to `rrgallery.co.nz`.

### Task 3: Hide source image dimensions from customers

**Files:**
- Modify: `src/app/designs/[slug]/page.test.tsx`
- Modify: `src/app/designs/[slug]/page.tsx`

**Interfaces:**
- Consumes: the existing public design detail facts list and `design.width` / `design.height` used by `next/image`.
- Produces: the same design detail page without a visible `Design image` fact row.

- [ ] **Step 1: Add the failing visibility assertions**

```tsx
expect(screen.queryByText("Design image")).not.toBeInTheDocument();
expect(screen.queryByText("1200 × 2400 px")).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
npm test -- --run 'src/app/designs/[slug]/page.test.tsx'
```

Expected: FAIL because the current page still renders the `Design image` row.

- [ ] **Step 3: Remove only the customer-facing fact row**

Delete:

```tsx
<div><dt>Design image</dt><dd>{design.width} × {design.height} px</dd></div>
```

Keep the `width={design.width}` and `height={design.height}` props on the artwork image.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run:

```bash
npm test -- --run 'src/app/designs/[slug]/page.test.tsx'
```

Expected: all tests in the file PASS.

- [ ] **Step 5: Run full verification and deploy the exact commit**

Run TypeScript, ESLint, the full Vitest suite, and the production build. Check the design detail at 390px and desktop width, then deploy a clean archive from the tested commit and verify the public page contains no visible pixel dimensions.
