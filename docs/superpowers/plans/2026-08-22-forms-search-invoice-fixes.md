# Forms Search and Invoice Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct invoice presentation and make Forms search/filtering match the approved eTeams-style workflow on desktop and mobile.

**Architecture:** Keep the existing Forms query-string and saved-view architecture. Extend its typed filter contract and repository expressions over already persisted production data, move the existing search controls into the shared Forms header, and centralize invoice address presentation so preview and PDF cannot diverge.

**Tech Stack:** Next.js App Router, React, TypeScript, Drizzle ORM, Vitest, Testing Library, pdf-lib, CSS Modules, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-22-forms-search-invoice-fixes.md`

## Global Constraints

- No database schema or migration changes.
- No pricing, payment, order state, authentication, or authorization changes.
- Do not expose finance or customer-contact filters without the existing permissions.
- Hide the Export CSV UI only; do not weaken or delete the protected endpoint.
- Use the existing personal saved-view API.
- Do not deploy Production.

---

### Task 1: Invoice presentation boundary

**Files:**
- Create: `src/server/invoices/invoice-address-lines.ts`
- Modify: `src/components/admin/invoice-preview.tsx`
- Modify: `src/components/admin/production-job-form.tsx`
- Modify: `src/server/invoices/invoice-pdf.ts`
- Test: `src/components/admin/production-job-form.test.tsx`
- Test: `src/components/admin/invoice-preview.test.tsx`
- Test: `src/server/invoices/invoice-pdf.test.ts`

**Interfaces:**
- Produces: `customerAddressLines(input)` and `deliveryAddressLines(input)` returning normalized display lines.
- Consumes: existing invoice draft/record fields without changing persistence.

- [ ] **Step 1: Write failing tests for a visible header download action, de-duplicated customer lines, and right-aligned PDF delivery operators.**
- [ ] **Step 2: Run the focused invoice tests and confirm the expected failures.**
- [ ] **Step 3: Add the minimal shared line normalizer and use it in preview/PDF; move the existing download link into the persisted overlay header.**
- [ ] **Step 4: Re-run the focused invoice tests and confirm they pass.**

### Task 2: Complete typed Forms filters

**Files:**
- Modify: `src/server/forms/forms-workbench-service.ts`
- Modify: `src/server/forms/drizzle-forms-workbench-repository.ts`
- Modify: `src/components/forms/forms-filter-builder.tsx`
- Modify: `src/app/forms/(portal)/page.tsx`
- Test: `src/server/forms/forms-workbench-service.test.ts`
- Test: `src/server/forms/drizzle-forms-workbench-repository.integration.test.ts`
- Test: `src/components/forms/forms-filter-builder.test.tsx`
- Test: `src/app/forms/(portal)/page.test.tsx`

**Interfaces:**
- Produces: validated text, number, date, boolean, user, item-size, file-presence, and configured custom-field conditions encoded through the existing query-string format.
- Consumes: existing production job, item, user, field-definition, and field-value tables; no schema changes.

- [ ] **Step 1: Write failing validation, UI, and repository tests for Submitted By and the manual-entry field families.**
- [ ] **Step 2: Run focused tests and confirm failures are caused by unsupported fields.**
- [ ] **Step 3: Extend the typed field metadata and repository expressions, including permission-gated finance/contact fields and dynamic custom fields.**
- [ ] **Step 4: Re-run focused filter tests and confirm they pass.**

### Task 3: eTeams-style search and saved-search layout

**Files:**
- Modify: `src/components/forms/forms-shell.tsx`
- Modify: `src/components/forms/forms-workbench.tsx`
- Modify: `src/components/forms/forms-filter-builder.tsx`
- Modify: `src/components/forms/forms-saved-views.tsx`
- Modify: `src/components/forms/forms.module.css`
- Test: `src/components/forms/forms-shell.test.tsx`
- Test: `src/components/forms/forms-workbench.test.tsx`
- Test: `src/components/forms/forms-saved-views.test.tsx`
- Test: `src/components/forms/forms-filter-builder.test.tsx`

**Interfaces:**
- Produces: one responsive search/filter control set in the Forms header and saved-search controls inside the filter dialog.
- Consumes: existing `/api/forms/views` create/delete behavior and query-string navigation.

- [ ] **Step 1: Write failing component tests for no Gallery/Export link, header search placement, presets, and save/delete controls in the dialog.**
- [ ] **Step 2: Run focused component tests and confirm expected failures.**
- [ ] **Step 3: Move/recompose existing controls without changing APIs or permissions.**
- [ ] **Step 4: Apply compact desktop/mobile CSS and re-run component tests.**

### Task 4: Mobile density and end-to-end verification

**Files:**
- Modify: `src/components/forms/forms.module.css`
- Test: `src/components/forms/forms-order-cards.test.tsx`

**Interfaces:**
- Produces: the same approved six mobile fields in a denser, touch-safe card.
- Consumes: existing `FormsOrderCards` data and behavior.

- [ ] **Step 1: Add CSS/DOM regression assertions for the six-field mobile card and compact rules.**
- [ ] **Step 2: Run the focused test and confirm the new compact contract fails.**
- [ ] **Step 3: Apply the minimal spacing/height CSS changes and re-run focused tests.**
- [ ] **Step 4: Run typecheck, changed-file ESLint, full lint, build, and `git diff --check`.**
- [ ] **Step 5: Render a real invoice PDF and inspect its PNG; verify local UI at 390px, 768px, and 1440px with screenshots and zero horizontal overflow.**
