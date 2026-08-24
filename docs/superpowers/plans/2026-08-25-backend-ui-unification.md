# Backend UI Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the operational backend UI across Forms and Admin while preserving all existing business behavior, then deploy the verified result from `main`.

**Architecture:** Extend the existing Forms and Admin CSS modules and add only small semantic markup hooks. Reuse the tested Order System visual commits, then finish filters, drawer, statistics, navigation, and shared Admin surfaces without changing routes, state, APIs, permissions, or data flow.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS Modules, Vitest, Testing Library, Impeccable 4.1.1, Vercel.

**Spec:** `docs/superpowers/specs/2026-08-25-backend-ui-unification-design.md`

## Global Constraints

- No production data, database, schema, migration, environment, auth, permission, payment, shipping, analytics, API, or business-logic changes.
- No new dependency or component library.
- Preserve all current URLs, fields, values, filters, inline editing, saved views, uploads, auto-save, invoice, and guarded delete behavior.
- Desktop stays dense; mobile controls remain at least 44px.
- Production release source must be `origin/main` and must pass the existing Vercel source guard.

---

### Task 1: Reuse the tested Order System foundation

**Files:**
- Modify: `src/components/forms/forms.module.css`
- Modify: `src/components/forms/forms-inline-cell.tsx`
- Modify: `src/components/forms/forms-inline-cell.test.tsx`
- Modify: `src/components/forms/forms-order-cards.tsx`
- Modify: `src/components/forms/forms-order-cards.test.tsx`
- Modify: `src/components/forms/forms-order-table.test.tsx`

**Interfaces:**
- Consumes: current Forms table, cards, inline editors, status colors, and CSS module.
- Produces: warm operational tokens, stronger desktop row hierarchy, compact mobile cards, and preserved inline editor values.

- [ ] Cherry-pick commits `1b2944c`, `e033cf8`, `60c6f09`, and `cc3a347`.
- [ ] Resolve only against current `origin/main`; do not import old plan/report files.
- [ ] Run `npm run test:run -- src/components/forms/forms-inline-cell.test.tsx src/components/forms/forms-order-table.test.tsx src/components/forms/forms-order-cards.test.tsx`.

### Task 2: Refine filters, saved searches, and manual order drawer

**Files:**
- Modify: `src/components/forms/forms-filter-builder.tsx`
- Modify: `src/components/forms/forms-filter-builder.test.tsx`
- Modify: `src/components/forms/forms.module.css`
- Modify: `src/components/admin/admin-form-visual-regression.test.ts`

**Interfaces:**
- Consumes: current filter draft state, contained-dialog dismissal, saved searches, persisted drawer width, native file input, and form sections.
- Produces: row-local remove controls, compact responsive filters, clearer drawer hierarchy, and styled native upload controls.

- [ ] Add a failing test that every remove button remains inside its filter condition row.
- [ ] Run the filter test and confirm the expected RED result.
- [ ] Add the minimal semantic hook and indexed accessible label, preserving callbacks and values.
- [ ] Add failing CSS-source assertions for mobile filter layout, section rhythm, and `::file-selector-button`.
- [ ] Implement the minimum CSS required for the approved layout.
- [ ] Run filter, saved-view, drawer, new-job, and visual-regression tests.

### Task 3: Improve complete-history statistics layout

**Files:**
- Modify: `src/components/forms/forms.module.css`
- Modify: `src/components/forms/forms-stats-chart.test.tsx`
- Verify: `src/components/forms/forms-stats-chart.tsx`
- Verify: `src/components/forms/forms-stats-dashboard.test.tsx`

**Interfaces:**
- Consumes: complete history rows, current width formula, chart scroller, latest-end initialization, tooltip, and dashed guide.
- Produces: full-width report cards and readable horizontal history without truncation.

- [ ] Add failing CSS-source assertions for full-width widgets, intrinsic chart width, and compact mobile report controls.
- [ ] Confirm RED.
- [ ] Implement styling only; retain every returned row and existing chart behavior.
- [ ] Run chart, dashboard, widget-result, and workbench tests.

### Task 4: Group Admin navigation without changing permissions

**Files:**
- Modify: `src/components/admin/admin-shell.tsx`
- Modify: `src/components/admin/admin-shell.test.tsx`
- Modify: `src/components/admin/admin.module.css`

**Interfaces:**
- Consumes: the current immutable link/permission pairs and mobile menu behavior.
- Produces: Dashboard plus Orders, Production, Content, Finance, and System navigation groups filtered by the existing permission function.

- [ ] Add a failing restricted-user test for group labels and link visibility.
- [ ] Confirm RED.
- [ ] Introduce immutable groups while retaining every existing href and permission.
- [ ] Style group labels, active rhythm, mobile menu overflow, focus, and touch targets.
- [ ] Run AdminShell tests including Escape, scroll lock, and restricted permissions.

### Task 5: Unify Admin Dashboard, Orders, Customers, and Payments surfaces

**Files:**
- Modify: `src/components/admin/admin.module.css`
- Modify: `src/components/admin/admin-form-visual-regression.test.ts`
- Verify: `src/app/admin/page.tsx`
- Verify: `src/app/admin/orders/page.tsx`
- Verify: `src/app/admin/customers/page.tsx`
- Verify: `src/app/admin/payment-requests/page.tsx`

**Interfaces:**
- Consumes: shared Admin class names already used by pages, tables, forms, panels, states, and buttons.
- Produces: accepted warm operational palette, compact metrics, stable table hierarchy, responsive filters, consistent actions, and single-column mobile details.

- [ ] Add failing CSS-source assertions for tokens, compact two-column phone metrics, table overflow/focus, filter reflow, 44px mobile targets, and status-safe surfaces.
- [ ] Confirm RED.
- [ ] Implement the shared CSS contract without page data or behavior changes.
- [ ] Run Admin dashboard, orders, customers, payment-request, form, and visual-regression tests.

### Task 6: Visual and release verification

**Files:**
- Verify all changed source and test files.

**Interfaces:**
- Consumes: the completed branch.
- Produces: verified screenshots, clean tests/build, and a Git-sourced Production deployment.

- [ ] Run Forms/Admin targeted tests, TypeScript, ESLint, knowledge check, schema check, Impeccable layout/full detectors, and `git diff --check`.
- [ ] Start the local app with the existing local environment and capture representative desktop/mobile Admin and Forms screenshots without exposing customer data.
- [ ] Fix one bounded batch of visual defects, rerun targeted verification, and stop polishing.
- [ ] Run the complete non-database suite and a production build using non-production build-only values.
- [ ] Commit the branch, fetch `origin/main`, and require a fast-forward-safe release from a clean release worktree.
- [ ] Push to `main`, wait for Vercel READY, and verify Production Branch, Git ref, SHA, aliases, and HTTP responses.

