# R&R Gallery Unified Admin Backoffice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a secure, real-data operations backoffice under `/admin` while preserving checkout, price, payment, upload, shipping, gallery, and order snapshot behaviour.

**Architecture:** Extend the current Better Auth database role into a server-enforced permission model, add append-only admin operation records, and build focused admin query/mutation services around existing Drizzle tables. Reuse the current gallery service and show the current code-authoritative product pricing without opening unsafe editing.

**Tech Stack:** Next.js 16 App Router, React 19, Better Auth, Drizzle ORM, PostgreSQL 16, Zod 4, Vitest, Testing Library.

## Global Constraints

- Use `http://192.168.4.199:3000` as the only browser-validation origin.
- Preserve historical order snapshots and all checkout repricing behaviour.
- Every `/admin/**` page and mutation authorizes on the server.
- Do not display or persist payment-provider secrets.
- Do not create a second product-price source.
- Use integer cents for money and reject negative values.
- Expected failures must have explicit user-visible feedback.
- Do not reset, seed over, or destructively migrate existing data.

---

### Task 1: Permission model and admin shell

**Files:**
- Modify: `src/server/db/schema/auth.ts`
- Modify: `src/server/auth/require-admin.ts`
- Modify: `src/server/auth/require-admin-page.ts`
- Create: `src/server/auth/admin-permissions.ts`
- Modify: `src/app/admin/layout.tsx`
- Create: `src/components/admin/admin-shell.tsx`
- Create: `src/components/admin/admin.module.css`
- Test: `src/server/auth/admin-permissions.test.ts`
- Test: `src/server/auth/require-admin-page.test.ts`
- Test: `src/components/admin/admin-shell.test.tsx`

**Interfaces:**
- Produces: `requireAdminPermission(permission)`, `requireAdminPage(path, permission?)`, `AdminShell`.

- [ ] Write failing tests for admin/staff/customer permission outcomes, preserved return URLs, and all required navigation links.
- [ ] Run the focused tests and confirm failures are caused by missing permissions/shell behaviour.
- [ ] Implement the minimum role map, guards, and shell.
- [ ] Run the focused tests until green.

### Task 2: Audit, order notes, history, and migrations

**Files:**
- Create: `src/server/db/schema/admin.ts`
- Modify: `src/server/db/schema/orders.ts`
- Modify: `src/server/db/schema/index.ts`
- Create: `src/server/admin/audit-service.ts`
- Create: `src/server/admin/order-admin-service.ts`
- Create: `drizzle/0009_*.sql`
- Test: `src/server/db/schema/admin-schema.test.ts`
- Test: `src/server/admin/audit-service.test.ts`
- Test: `src/server/admin/order-admin-service.test.ts`

**Interfaces:**
- Produces: `AdminAuditWriter.write`, `AdminOrderService.list`, `detail`, `changeStatus`, `addNote`, and `setTracking`.

- [ ] Write failing schema and service tests for append-only audit data, allowed transitions, idempotency, and immutable price snapshots.
- [ ] Run the focused tests and confirm expected failures.
- [ ] Add the schema, service, repository queries, and generated migration.
- [ ] Run schema/service tests and migration checks.

### Task 3: Orders list and detail UI

**Files:**
- Create: `src/app/admin/orders/page.tsx`
- Create: `src/app/admin/orders/[orderId]/page.tsx`
- Create: `src/components/admin/order-table.tsx`
- Create: `src/components/admin/order-detail.tsx`
- Create: `src/components/admin/order-actions.tsx`
- Create: `src/app/api/admin/orders/[orderId]/route.ts`
- Create: `src/app/api/admin/orders/[orderId]/notes/route.ts`
- Test: colocated page, component, and route tests.

**Interfaces:**
- Consumes: Task 1 guards and Task 2 order/audit services.

- [ ] Write failing tests for filter parsing, URL persistence, pagination, detail projection, permissions, CSRF, validation, feedback, and duplicate submission.
- [ ] Run focused tests and confirm expected failures.
- [ ] Implement server pages, client mutations, and protected routes.
- [ ] Run focused tests until green.

### Task 4: Products source-of-truth administration

**Files:**
- Create: `src/server/admin/product-admin-service.ts`
- Create: `src/app/admin/products/page.tsx`
- Create: `src/components/admin/product-table.tsx`
- Test: `src/server/admin/product-admin-service.test.ts`
- Test: `src/app/admin/products/page.test.tsx`

**Interfaces:**
- Produces: immutable live catalogue/configuration projections only.

- [ ] Write failing tests that compare admin projections with the live catalogue and configuration schemas.
- [ ] Run focused tests and confirm failures.
- [ ] Implement the read-only real-data page and explicit safe editing boundary.
- [ ] Run focused tests until green.

### Task 5: Content entries and publishing

**Files:**
- Modify: `src/server/db/schema/admin.ts`
- Create: `src/server/admin/content-service.ts`
- Create: `src/app/admin/content/page.tsx`
- Create: `src/components/admin/content-form.tsx`
- Create: `src/app/api/admin/content/[key]/route.ts`
- Modify: first supported storefront content consumers.
- Test: service, route, page, and fallback tests.

**Interfaces:**
- Produces: `getPublishedContent(key, fallback)` and validated draft/publish mutations.

- [ ] Write failing tests for allow-listed keys, length limits, plain text, draft/publish, audit, and code fallback.
- [ ] Run focused tests and confirm expected failures.
- [ ] Implement storage, page, route, and storefront reads.
- [ ] Run focused tests until green.

### Task 6: Gallery integration and remaining real-data pages

**Files:**
- Modify: `src/app/admin/design-gallery/**`
- Modify: `src/app/api/admin/design-gallery/**`
- Create only real-data pages for dashboard, customers, shipping/payment status, media inventory, and audit where supported.
- Test: updated gallery and new page tests.

- [ ] Write failing integration tests for shell rendering and audit logging.
- [ ] Implement without replacing the gallery service or exposing secrets/private uploads.
- [ ] Run focused tests until green.

### Task 7: Verification

- [ ] Run `npm run test:run`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run db:check` with the configured test database.
- [ ] Run `npm run build`.
- [ ] Verify the required admin pages in the real browser at 390, 768, 1024, and 1440 pixels on `http://192.168.4.199:3000`.
- [ ] Record exact remaining unimplemented capabilities and deployment requirements.
