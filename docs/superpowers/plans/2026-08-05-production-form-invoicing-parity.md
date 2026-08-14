# Production Form and Invoicing Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the local eTeams/Order Manager field set and add persistent, audited GST invoice creation and PDF download to the Next.js production workbench.

**Architecture:** Keep workflow-critical values typed on `production_jobs`, store historical/administrator-defined values through bounded field-definition and field-value tables, and add a separate invoice aggregate with immutable issued data. Reuse current admin permissions, audit, private routes, idempotency and optimistic-concurrency patterns.

**Tech Stack:** Next.js 16, React 19, TypeScript, Drizzle ORM/PostgreSQL, Zod, Vitest, Testing Library and `pdf-lib` for server-side A4 PDFs.

## Global Constraints

- Preserve every active local Order Manager field and retain every mapped eTeams historical value.
- Preserve web-order pricing, GST, shipping, payment and address snapshots as authoritative.
- Public checkout delivery choices remain Post and Pickup.
- Do not modify the WordPress/eTeams source system or import customer rows during feature construction.
- Finance and invoice data require existing finance permissions.
- Issued invoice data is immutable and every mutation is audited.
- Use integer cents and deterministic 15% tax-inclusive GST calculations.
- Do not commit, reset, clean, stash or overwrite unrelated worktree changes.

---

### Task 1: Typed field parity and historical field storage

**Files:**
- Modify: `src/server/db/schema/production.ts`
- Modify: `src/server/db/schema/index.ts`
- Test: `src/server/db/schema/production-schema.test.ts`
- Modify: `src/server/production/production-job-service.ts`
- Test: `src/server/production/production-job-service.test.ts`
- Modify: `src/server/production/drizzle-production-job-repository.ts`
- Test: `src/server/production/drizzle-production-job-repository.integration.test.ts`
- Generate: `drizzle/0016_*.sql`

**Interfaces:**
- Produces typed fields `webOrderNumber`, `deliveryAddress`, `paymentReconciliationStatus`, `artistPaidAt`, `completedAt`.
- Produces `productionFieldDefinitions` and `productionFieldValues` with unique `(jobId, fieldId)` values.
- Extends `ProductionCustomerSource` with `rnr` and `wechat`; extends staff delivery methods without changing checkout types.

- [ ] Add failing schema tests for the new columns, field definition/value constraints and eTeams definition keys.
- [ ] Run `npm test -- --run src/server/db/schema/production-schema.test.ts` and confirm missing-schema failures.
- [ ] Add failing service tests proving manual create/update accepts the active legacy fields, derives owing/profit, and rejects unknown reconciliation labels or invalid custom values.
- [ ] Run the service tests and confirm behavior failures.
- [ ] Implement the typed schema and strict Zod inputs; represent `artist_paid` and `completed` as timestamps while preserving raw imported values separately.
- [ ] Implement repository reads/writes and audit-safe projections.
- [ ] Generate migration 0016, inspect it for additive-only changes, then run focused unit/integration tests.

### Task 2: Invoice calculation and validation domain

**Files:**
- Create: `src/server/invoices/invoice-domain.ts`
- Test: `src/server/invoices/invoice-domain.test.ts`

**Interfaces:**
- Produces `parseInvoiceDraft(input)`, `calculateInvoiceTotals(draft)` and `buildInvoiceNumber(jobNumber)`.
- `calculateInvoiceTotals` returns `{ grossCents, discountCents, subtotalExGstCents, gstCents, totalInclGstCents }`.
- Quantity is `quantityMilli`; item rate is `rateInclGstCents`; GST is fixed at 1500 basis points.

- [ ] Write failing table tests with hand-calculated totals for one item, multiple items, fractional quantity, discount, zero total and rounding boundaries.
- [ ] Run the focused test and confirm functions are absent.
- [ ] Implement strict validation, exact integer arithmetic and deterministic invoice numbering.
- [ ] Run focused tests and mutation-check the wrong GST and wrong discount branches.

### Task 3: Persistent invoice repository and lifecycle

**Files:**
- Modify: `src/server/db/schema/production.ts`
- Test: `src/server/db/schema/production-schema.test.ts`
- Create: `src/server/invoices/invoice-service.ts`
- Test: `src/server/invoices/invoice-service.test.ts`
- Create: `src/server/invoices/drizzle-invoice-repository.ts`
- Test: `src/server/invoices/drizzle-invoice-repository.integration.test.ts`
- Update: `drizzle/0016_*.sql`

**Interfaces:**
- Produces `invoices` and `invoiceItems` tables.
- Produces `createInvoiceService(repository)` with `getOrCreateDraft`, `updateDraft`, `issue`, `void` and `getDocument`.
- Repository writes invoice, items and `adminAuditLogs` atomically.

- [ ] Add failing schema and lifecycle tests for one invoice per job, unique number, non-negative totals and ordered items.
- [ ] Run focused tests and confirm failures.
- [ ] Implement draft seeding from web-order or manual-job projections without copying editable web financial truth into production jobs.
- [ ] Implement optimistic updates, idempotent issue, issued immutability, explicit void and append-only audit events.
- [ ] Run isolated PostgreSQL integration tests from migration zero through 0016.

### Task 4: Protected invoice APIs and PDF

**Files:**
- Create: `src/server/invoices/invoice-pdf.ts`
- Test: `src/server/invoices/invoice-pdf.test.ts`
- Create: `src/server/admin/admin-invoice-runtime.ts`
- Create: `src/app/api/admin/jobs/[jobId]/invoice/route.ts`
- Test: `src/app/api/admin/jobs/[jobId]/invoice/route.test.ts`
- Create: `src/app/api/admin/invoices/[invoiceId]/pdf/route.ts`
- Test: `src/app/api/admin/invoices/[invoiceId]/pdf/route.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- `GET /api/admin/jobs/:jobId/invoice` gets or seeds a draft for finance users.
- `PUT` updates a draft; `POST` accepts `{ action: "issue" | "void", idempotencyKey, expectedUpdatedAt }`.
- `GET /api/admin/invoices/:invoiceId/pdf` returns `application/pdf` with a safe attachment filename.

- [ ] Install the pinned current stable `pdf-lib` package and record only its package files.
- [ ] Write failing permission/origin/concurrency/lifecycle route tests and a PDF test asserting `%PDF`, non-empty content and escaped customer data.
- [ ] Run tests and confirm missing-route/generator failures.
- [ ] Implement protected routes using `view_production_finance` and `update_production_finance`.
- [ ] Implement a deterministic one-page A4 document with business, customer, item, GST, total, payment and terms sections.
- [ ] Run route and PDF tests.

### Task 5: Form parity and invoice workbench UI

**Files:**
- Modify: `src/components/admin/production-job-form.tsx`
- Test: `src/components/admin/production-job-form.test.tsx`
- Modify: `src/components/admin/production-job-controls.tsx`
- Create: `src/components/admin/invoice-panel.tsx`
- Test: `src/components/admin/invoice-panel.test.tsx`
- Modify: `src/app/admin/jobs/[jobId]/page.tsx`
- Modify: `src/components/admin/admin.module.css`

**Interfaces:**
- Manual entry exposes every active local field in the appropriate section.
- Detail view separates operational, finance, custom and legacy values.
- `InvoicePanel` loads persisted draft data, edits line items, displays independently calculated totals, issues/voids and downloads the protected PDF.

- [ ] Add failing component tests for delivery address, web reference, R&R/WeChat, reconciliation, artist paid, completed, historical separation and invoice actions.
- [ ] Run tests and confirm missing controls.
- [ ] Implement grouped fields without exposing finance data to staff.
- [ ] Implement the responsive invoice editor/preview with multiple line items and accessible controls.
- [ ] Run component/page tests at desktop and 390px layout contracts.

### Task 6: Dynamic field administration and safe inline operations

**Files:**
- Create: `src/server/production/production-field-service.ts`
- Test: `src/server/production/production-field-service.test.ts`
- Create: `src/app/admin/jobs/fields/page.tsx`
- Create: `src/app/api/admin/jobs/fields/route.ts`
- Test: `src/app/api/admin/jobs/fields/route.test.ts`
- Modify: `src/app/admin/jobs/page.tsx`
- Modify: `src/components/admin/admin-shell.tsx`
- Modify: `src/components/admin/admin.module.css`

**Interfaces:**
- Admin-only field configuration supports label/type/options/required/enabled/section/sort/display settings while field keys remain immutable.
- Safe inline updates are limited to assignee, needed date and non-finance operational status through the existing job mutation service.

- [ ] Write failing tests for immutable keys, option validation, disabling without data loss, role checks and audited changes.
- [ ] Run focused tests and confirm failures.
- [ ] Implement the field administration service, API and page.
- [ ] Add bounded inline operational editing and reuse optimistic concurrency.
- [ ] Run permission, component and integration tests.

### Task 7: Migration and complete verification

**Files:**
- Modify only files required by failures found during verification.

**Interfaces:**
- Uses the official local origin `http://192.168.4.199:3000`.

- [ ] Apply migration 0016 to an isolated database and the configured local database after backup verification.
- [ ] Run `npm run db:check`, `npm run typecheck`, `npm run lint`, the complete Vitest suite and `npm run build`.
- [ ] Verify manual form, web job, invoice edit/issue/PDF, finance redaction, audit, 390px mobile and desktop layouts in the real browser.
- [ ] Verify the source WordPress/eTeams directory is unchanged.
- [ ] Run `git diff --check`, `git diff --stat` and `git status --short`; do not commit.
