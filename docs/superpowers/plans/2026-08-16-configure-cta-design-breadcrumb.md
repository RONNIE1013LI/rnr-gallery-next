# Configure CTA and Design Breadcrumb Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the redundant configuration-page CTA and replace the loose design-detail breadcrumb with a responsive, deliberate hierarchy.

**Architecture:** Keep the existing page components and shared storefront stylesheet. Change only visible markup and CSS; retain the current design URL, Gallery destination, structured-data breadcrumb, configurator form, pricing, uploads, cart, and checkout behavior.

**Tech Stack:** Next.js App Router, React 19, CSS Modules, Vitest, Testing Library.

## Global Constraints

- Remove the `Start Customising` link from the configuration-page introduction.
- Preserve the `#customise` form anchor and all configuration behavior.
- Desktop visible breadcrumb: `Home › Design Gallery › Current design`, single line with current-label truncation.
- Mobile visible breadcrumb: one `‹ Design Gallery` link; hide the other visible levels.
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

### Task 2: Normalize the visible design-detail breadcrumb

**Files:**
- Modify: `src/app/designs/[slug]/page.test.tsx`
- Modify: `src/app/designs/[slug]/page.tsx`
- Modify: `src/components/storefront.module.css`

**Interfaces:**
- Consumes: `title`, `/`, `/design-gallery`, and existing `buildBreadcrumbData()` JSON-LD.
- Produces: semantic visible breadcrumb classes while leaving `rnr-design-breadcrumbs` unchanged.

- [ ] **Step 1: Add focused assertions for semantic desktop and mobile breadcrumb hooks**

Import the existing CSS module in the test:

```tsx
import styles from "@/components/storefront.module.css";
```

```tsx
const visibleBreadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
expect(within(visibleBreadcrumb).getByRole("link", { name: "Home" }))
  .toHaveClass(styles.breadcrumbHome);
expect(within(visibleBreadcrumb).getByRole("link", { name: "Design Gallery" }))
  .toHaveClass(styles.breadcrumbGallery);
expect(within(visibleBreadcrumb).getByText("40th Birthday"))
  .toHaveClass(styles.breadcrumbCurrent);
expect(within(visibleBreadcrumb).getAllByText("›")).toHaveLength(2);
```

- [ ] **Step 2: Run the design-detail test and confirm it fails**

Run:

```bash
npm test -- --run 'src/app/designs/[slug]/page.test.tsx'
```

Expected: FAIL because the semantic classes and `›` separators do not exist yet.

- [ ] **Step 3: Add explicit breadcrumb classes and consistent separators**

Use the existing navigation and add:

```tsx
<Link className={styles.breadcrumbHome} href="/">Home</Link>
<span className={styles.breadcrumbSeparator} aria-hidden="true">›</span>
<Link className={styles.breadcrumbGallery} href="/design-gallery">
  <span className={styles.breadcrumbBackIcon} aria-hidden="true">‹</span>
  Design Gallery
</Link>
<span className={styles.breadcrumbSeparator} aria-hidden="true">›</span>
<span className={styles.breadcrumbCurrent} aria-current="page">{title}</span>
```

- [ ] **Step 4: Implement responsive CSS in the existing stylesheet**

Desktop requirements:

```css
.publicBreadcrumbs {
  min-width: 0;
  flex-wrap: nowrap;
  white-space: nowrap;
}

.breadcrumbCurrent {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.breadcrumbBackIcon {
  display: none;
}
```

Mobile requirements inside the existing `@media (max-width: 820px)` block:

```css
.publicBreadcrumbs {
  min-height: 32px;
  font-size: 0.95rem;
}

.breadcrumbHome,
.breadcrumbSeparator,
.breadcrumbCurrent {
  display: none;
}

.breadcrumbGallery {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-weight: 650;
}

.breadcrumbBackIcon {
  display: inline;
  font-size: 1.25em;
}
```

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
  BETTER_AUTH_SECRET='8f3a91c7d42e6b50a1f89c36e704bd25c9a81e6f43d702b598ca14e73f60bd92' \
  npm run build
```

Expected: TypeScript, ESLint, all tests, and production build pass. The build-only auth value is supplied only to the process and is never stored or committed.

- [ ] **Step 7: Verify responsive rendering and deploy the exact commit**

Check one public design detail at approximately 390px and desktop width. Confirm mobile shows only `‹ Design Gallery`; desktop shows all three levels on one line; the configuration page has no introductory CTA. Commit only the scoped files, deploy a clean candidate from the exact commit, smoke-test it, then promote that same deployment to `rrgallery.co.nz`.
