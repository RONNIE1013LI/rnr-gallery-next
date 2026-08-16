# Order Entry and Invoice Implementation Plan

> **For Codex:** Follow this plan in order. Use test-driven development for each task and run the focused checks before committing that task.

**Goal:** Rebuild the Forms portal manual-entry and invoice interfaces around the supplied studio workflow, add safe paste-to-customer-field parsing, and move all new web/manual orders to one concurrency-safe numeric sequence beginning at `08000`.

**Architecture:** Preserve the current production-job, web-order, invoice, payment, permission, and audit models. Add one PostgreSQL sequence used by both order creation paths. Extend manual job creation with an optional validated invoice draft so the production job and invoice can be inserted in the existing production transaction. Extract a controlled invoice workspace used by both pre-save manual entry and persisted invoices.

**Stack:** Next.js App Router, React 19, TypeScript, Drizzle ORM/PostgreSQL, Zod, pdf-lib, libphonenumber-js, Vitest/Testing Library, Playwright.

---

## Task 1: Add a shared numeric order-number allocator

**Files:**

- Create: `src/server/orders/order-number.ts`
- Create: `src/server/orders/order-number.test.ts`
- Create: `drizzle/0027_*.sql` through `npm run db:generate`
- Modify: `src/server/db/schema/orders.ts`
- Modify: `src/server/orders/order-service.ts`
- Modify: `src/server/orders/order-service.test.ts`
- Modify: `src/app/api/checkout/order/route-handler.ts`
- Modify: `src/server/production/production-job-service.ts`
- Modify: `src/server/production/production-job-service.test.ts`
- Modify: `src/server/admin/admin-production-runtime.ts`
- Modify: `src/server/production/proof-access-link.ts`
- Modify: `src/server/production/proof-access-link.test.ts`

1. Write failing tests for formatting `8000` as `08000`, numbers after `99999`, and accepting both numeric and legacy public order references.
2. Add a PostgreSQL sequence starting at `8000`; existing test identifiers do not seed or advance it.
3. Implement one async database allocator that returns the next value padded to at least five digits.
4. Inject the allocator into online order creation and manual job creation. A web production job continues to copy its web order number and must not consume a second number.
5. Keep legacy references readable; do not rename existing database rows.
6. Run:

   `npm test -- src/server/orders/order-number.test.ts src/server/orders/order-service.test.ts src/server/production/production-job-service.test.ts src/server/production/proof-access-link.test.ts`

7. Run `npm run db:check`.
8. Commit: `feat: add shared numeric order numbering`

## Task 2: Add tested customer-block paste parsing

**Files:**

- Create: `src/domain/forms/customer-block-parser.ts`
- Create: `src/domain/forms/customer-block-parser.test.ts`
- Modify: `src/components/admin/production-job-form.tsx`
- Modify: `src/components/admin/production-job-form.test.tsx`

1. Write failing parser tests for the supplied Litea Murtagh example, explicit `+64`, explicit `+61`, an AU local mobile with Australia delivery selected, invalid phone text, ambiguous lines, and existing populated fields.
2. Implement a pure local parser using `libphonenumber-js`:
   - detect email;
   - select NZ/AU from explicit country information or Australia shipping, otherwise NZ;
   - normalize valid phones to E.164 (`+64`/`+61`);
   - identify an unambiguous leading customer name;
   - return only remaining physical-address lines as the address.
3. Add `onPaste` handling to `DlvryAddr`; fill only empty customer fields and never overwrite staff input.
4. Keep unrecognized/ambiguous content in `DlvryAddr` and show a short non-blocking parse result near the field.
5. Run:

   `npm test -- src/domain/forms/customer-block-parser.test.ts src/components/admin/production-job-form.test.tsx`

6. Commit: `feat: parse pasted manual customer details`

## Task 3: Support an invoice draft before a manual order exists

**Files:**

- Create: `src/components/admin/invoice-workspace.tsx`
- Create: `src/components/admin/invoice-workspace.test.tsx`
- Create: `src/components/admin/invoice-preview.tsx`
- Create: `src/app/api/forms/invoices/draft/pdf/route.ts`
- Create: `src/app/api/forms/invoices/draft/pdf/route-handler.ts`
- Create: `src/app/api/forms/invoices/draft/pdf/route.test.ts`
- Modify: `src/components/admin/invoice-panel.tsx`
- Modify: `src/components/admin/invoice-panel.test.tsx`
- Modify: `src/server/admin/admin-invoice-runtime.ts`
- Modify: `src/server/invoices/invoice-domain.ts`
- Modify: `src/server/invoices/invoice-domain.test.ts`
- Modify: `src/server/invoices/invoice-pdf.ts`
- Modify: `src/server/invoices/invoice-pdf.test.ts`
- Modify: `src/components/admin/admin.module.css`

1. Write failing component tests for opening an `INV-DRAFT` workspace, editing fields, live totals/preview, responsive editor/preview order, closing without losing the draft, and downloading through the protected draft-PDF route.
2. Extract the existing editable invoice controls and calculation display into a controlled workspace. Keep the persisted `InvoicePanel` API and issue/void behavior unchanged.
3. Build an HTML A4 preview that uses the same draft values, currency, GST rate, and calculated totals as the server invoice domain.
4. Add a protected `POST /api/forms/invoices/draft/pdf` endpoint. It must require finance permission, enforce trusted-origin and bounded-body checks, parse the existing invoice schema, generate `INV-DRAFT.pdf`, and persist nothing.
5. Keep existing PDF generation as the only PDF calculation/rendering source.
6. Run:

   `npm test -- src/components/admin/invoice-workspace.test.tsx src/components/admin/invoice-panel.test.tsx src/app/api/forms/invoices/draft/pdf/route.test.ts src/server/invoices/invoice-domain.test.ts src/server/invoices/invoice-pdf.test.ts`

7. Commit: `feat: add pre-save invoice workspace`

## Task 4: Persist manual job and optional invoice atomically

**Files:**

- Modify: `src/server/production/production-job-service.ts`
- Modify: `src/server/production/production-job-service.test.ts`
- Modify: `src/server/production/drizzle-production-job-repository.ts`
- Modify: `src/server/production/drizzle-production-job-repository.integration.test.ts`
- Modify: `src/server/admin/admin-invoice-runtime.ts`
- Modify: `src/server/admin/admin-production-runtime.ts`
- Modify: `src/app/api/forms/jobs/route-handler.ts`
- Modify: `src/app/api/forms/jobs/route.test.ts`
- Modify: `src/components/admin/production-job-form.tsx`
- Modify: `src/components/admin/production-job-form.test.tsx`

1. Write failing service and repository tests proving that an optional invoice draft is permission-checked, schema-validated, included in idempotency checks, and inserted in the same database transaction as the manual job.
2. Share the existing invoice business defaults and invoice-domain calculation functions; do not duplicate GST or total formulas in the production code.
3. Extend manual creation with optional `invoiceDraft`. Insert the invoice and line items in the existing job transaction and add the normal invoice audit record.
4. Prove rollback behavior by forcing invoice insertion failure and asserting that neither job nor invoice remains.
5. Submit the pre-save draft from `ProductionJobForm` only when staff opened/edited it; otherwise keep the existing lazy invoice creation behavior.
6. After creation, use `INV-{numeric order number}` and replace draft reference `DRAFT` with the assigned numeric order number unless staff supplied a separate reference.
7. Run:

   `npm test -- src/server/production/production-job-service.test.ts src/server/production/drizzle-production-job-repository.integration.test.ts src/app/api/forms/jobs/route.test.ts src/components/admin/production-job-form.test.tsx`

8. Commit: `feat: save manual orders with invoice drafts`

## Task 5: Reorder the manual and online production interfaces

**Files:**

- Modify: `src/domain/forms/forms-parity.ts`
- Modify: `src/domain/forms/forms-parity.test.ts`
- Modify: `src/components/admin/production-job-form.tsx`
- Modify: `src/components/admin/production-job-form.test.tsx`
- Modify: `src/components/admin/production-job-detail.tsx`
- Modify: `src/components/admin/production-job-controls.tsx`
- Modify: `src/components/admin/production-job-controls.test.tsx`
- Modify: `src/components/admin/admin.module.css`
- Modify: `src/components/forms/forms.module.css`
- Modify: `src/app/forms/(portal)/new/page.tsx`
- Modify: `src/app/forms/(portal)/new/page.test.tsx`
- Modify: `src/app/forms/(portal)/jobs/[jobId]/page.test.tsx`

1. Write failing tests for the agreed section order and the presence/read-only status of shared online-order fields.
2. Reorder the manual entry into compact sections: record summary; order; product/size; payment; design/notes; delivery; customer; internal production status; cost/profit.
3. Add the top Invoice action. It opens the pre-save workspace and does not require a saved job ID.
4. Reorder online production details and controls to the same shared-field sequence. Keep checkout pricing, payment, and online order state read-only.
5. Match the reference's dense desktop workflow while retaining a usable one-column mobile form with 44–48px controls.
6. Run:

   `npm test -- src/domain/forms/forms-parity.test.ts src/components/admin/production-job-form.test.tsx src/components/admin/production-job-controls.test.tsx 'src/app/forms/(portal)/new/page.test.tsx' 'src/app/forms/(portal)/jobs/[jobId]/page.test.tsx'`

7. Commit: `feat: align forms portal order workflow`

## Task 6: Visual and full regression verification

**Files:**

- Modify: `design-qa.md` (append evidence only)
- Modify or create focused Playwright tests under the repository's existing browser-test location, if present.

1. Run focused tests from Tasks 1–5 together.
2. Run `npm run typecheck`.
3. Run `npm run lint`.
4. Run `npm test -- --run`.
5. Run `npm run build`.
6. Apply the migration to the local test database only, then verify the first disposable web/manual numbers share the `08000` sequence. Do not alter production data in this task.
7. At `http://192.168.4.199:3000`, capture and compare:
   - Order entry desktop;
   - Order entry at 390px;
   - pre-save Invoice desktop;
   - pre-save Invoice at 390px;
   - one online order detail using the shared field order.
8. Exercise the supplied paste block and an AU block; verify empty-only filling and `+64`/`+61` normalization.
9. Download and open both a draft PDF and a persisted PDF.
10. Append screenshots, commands, pass/fail results, and any visual deviations to `design-qa.md`.
11. Commit: `test: verify order entry and invoice workflow`

## Deployment boundary

This plan does not deploy automatically. Production deployment and production database migration require a separate explicit instruction after all local tests and visual checks pass.
