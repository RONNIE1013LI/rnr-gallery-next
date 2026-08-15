# Footer Payment Logos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a responsive, accessible footer strip containing Visa, Mastercard, American Express, Apple Pay, Google Pay, and Afterpay logos.

**Architecture:** `SiteFooter` renders existing bundled brand SVG components as a labelled semantic section between navigation and legal content. `globals.css` normalizes tile size and responsive wrapping without changing checkout logic.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS, Vitest, Testing Library

## Global Constraints

- Display all six required brands: Visa, Mastercard, American Express, Apple Pay, Google Pay, and Afterpay.
- Do not change payment-provider behavior, checkout pricing, or order logic.
- Use the existing `react-icons` dependency; do not add a dependency or remote image request.
- Preserve the existing footer structure and visual system.

---

### Task 1: Accessible payment strip

**Files:**
- Modify: `src/components/site-footer.tsx`
- Modify: `src/app/globals.css`
- Test: `src/components/site-shell.test.tsx`

**Interfaces:**
- Consumes: brand SVG components from the existing `react-icons` package.
- Produces: `.site-footer__payments`, a labelled footer section containing six named logo graphics.

- [ ] **Step 1: Write the failing regression test**

```tsx
it("shows every accepted payment brand inside the footer", () => {
  render(<SiteFooter />);
  const footer = screen.getByRole("contentinfo");
  const payments = within(footer).getByRole("region", { name: "Accepted payments" });

  for (const name of ["Visa", "Mastercard", "American Express", "Apple Pay", "Google Pay", "Afterpay"]) {
    expect(within(payments).getByRole("img", { name })).toHaveAttribute(
      "aria-label",
      name,
    );
  }
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `npm test -- src/components/site-shell.test.tsx -t "shows every accepted payment brand"`

Expected: FAIL because the labelled region does not exist.

- [ ] **Step 3: Add bundled brand icons and minimal footer markup**

Render the six-item list in `SiteFooter` between `.site-footer__grid` and `.site-footer__legal`, using existing `react-icons` SVG components with `role="img"` and meaningful `aria-label` values.

- [ ] **Step 4: Add responsive styling**

Use a centered flex row on wide screens and an equal-width three-column grid on narrow screens. Normalize marks with a white tile, contained image sizing, and override the footer navigation list-item spacing rule for the logo list.

- [ ] **Step 5: Run focused verification and confirm GREEN**

Run: `npm test -- src/components/site-shell.test.tsx`

Expected: all `site shell` tests PASS.

- [ ] **Step 6: Run repository verification**

Run: `npm run typecheck && npm run lint -- src/components/site-footer.tsx src/components/site-shell.test.tsx && npm run test:run && npm run build`

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-08-16-footer-payment-logos-design.md docs/superpowers/plans/2026-08-16-footer-payment-logos.md src/components/site-footer.tsx src/components/site-shell.test.tsx src/app/globals.css
git commit -m "feat: add payment logos to site footer"
```

### Task 2: Production deployment verification

**Files:**
- No source files changed.

**Interfaces:**
- Consumes: the verified production build from Task 1.
- Produces: a READY production deployment serving all six local logo assets.

- [ ] **Step 1: Deploy the verified commit to production**

Use the repository's established Vercel deployment workflow and confirm the production aliases resolve to the new deployment.

- [ ] **Step 2: Verify production assets and footer markup**

Check the production homepage and each `/media/payments/*.svg` URL for successful responses, then verify the labelled section contains all six images.

- [ ] **Step 3: Verify mobile layout**

At a narrow mobile viewport, confirm the six logo tiles wrap without horizontal overflow and remain above the copyright row.

- [ ] **Step 4: Record deployment evidence**

Capture the deployed commit, deployment identifier, production URL, and automated/browser verification outcomes in the completion report.
