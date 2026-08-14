# Production Job Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified Next.js production-job workbench that automatically records web orders and supports audited manual entry.

**Architecture:** Add typed production job and job item tables beside immutable ecommerce orders. Web jobs are inserted in the existing order transaction; manual jobs use a dedicated service and APIs. Shared admin pages project linked order status/payment without creating a second source of truth.

**Tech Stack:** Next.js 16, React 19, TypeScript, Drizzle ORM/PostgreSQL, Zod, Better Auth, Vitest and Testing Library.

## Global Constraints

- Preserve checkout pricing, GST, payment, shipping, address and upload snapshots.
- Do not create checkout sessions or ecommerce orders for manual jobs.
- Keep web-order job creation atomic and idempotent.
- Staff cannot see finance fields.
- All mutations require server authorization, same-origin checks, validation and audit records.
- Do not import historical eTeams customer data during this implementation.

---

### Task 1: Production schema and permissions

**Files:**
- Create: `src/server/db/schema/production.ts`
- Modify: `src/server/db/schema/index.ts`
- Modify: `src/server/auth/admin-permissions.ts`
- Modify: `src/server/auth/admin-permissions.test.ts`
- Create: `src/server/db/schema/production-schema.test.ts`
- Generate: `drizzle/0010_*.sql`
- Generate: `drizzle/meta/0010_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

**Interfaces:**
- Produces `productionJobs`, `productionJobItems`, production enums and permissions.

- [ ] Write failing permission and schema contract tests.
- [ ] Run the focused tests and confirm the expected missing exports/permissions.
- [ ] Implement schema constraints and permission mapping.
- [ ] Generate and inspect the migration.
- [ ] Run focused tests and `npm run db:check`.

### Task 2: Manual job domain service

**Files:**
- Create: `src/server/production/production-job-service.ts`
- Create: `src/server/production/production-job-service.test.ts`

**Interfaces:**
- Produces `parseProductionJobFilters`, `createProductionJobService`, mutation input/output types and job-number generation.
- Consumes a repository interface that creates, queries and updates jobs atomically.

- [ ] Write failing tests for filter parsing, manual validation, derived owing/profit, idempotency and role-safe updates.
- [ ] Run tests and confirm feature-absence failures.
- [ ] Implement the minimum typed service.
- [ ] Run focused tests.

### Task 3: Drizzle production repository and atomic web linkage

**Files:**
- Create: `src/server/production/drizzle-production-job-repository.ts`
- Create: `src/server/production/drizzle-production-job-repository.integration.test.ts`
- Modify: `src/server/orders/drizzle-order-repository.ts`
- Modify: `src/server/orders/drizzle-order-repository.integration.test.ts`

**Interfaces:**
- Consumes production service repository interfaces.
- Produces list/detail/manual-create/update database operations.
- Extends `createAtomicOrder` so one web job and one job item per order item are inserted before transaction completion.

- [ ] Add a failing integration assertion that creating an order also creates exactly one linked job with matching items.
- [ ] Add a failing retry assertion proving no duplicate job.
- [ ] Insert the job and item snapshots inside the existing transaction.
- [ ] Implement manual repository operations and audit writes.
- [ ] Run the focused integration tests serially.

### Task 4: Admin runtime and protected APIs

**Files:**
- Create: `src/server/admin/admin-production-runtime.ts`
- Create: `src/app/api/admin/jobs/route.ts`
- Create: `src/app/api/admin/jobs/route.test.ts`
- Create: `src/app/api/admin/jobs/[jobId]/route.ts`
- Create: `src/app/api/admin/jobs/[jobId]/route.test.ts`

**Interfaces:**
- `GET /api/admin/jobs` lists filtered jobs.
- `POST /api/admin/jobs` creates a manual job.
- `PATCH /api/admin/jobs/:jobId` updates allowed operational fields.

- [ ] Write failing route tests for 401/403, origin rejection, validation, successful creation, duplicate submission and finance permission enforcement.
- [ ] Run tests and confirm expected failures.
- [ ] Implement runtime and routes using existing authorization/error patterns.
- [ ] Run route tests.

### Task 5: Production workbench pages

**Files:**
- Modify: `src/components/admin/admin-shell.tsx`
- Modify: `src/components/admin/admin-shell.test.tsx`
- Create: `src/app/admin/jobs/page.tsx`
- Create: `src/app/admin/jobs/new/page.tsx`
- Create: `src/app/admin/jobs/[jobId]/page.tsx`
- Create: `src/components/admin/production-job-form.tsx`
- Create: `src/components/admin/production-job-form.test.tsx`
- Create: `src/components/admin/production-job-controls.tsx`
- Modify: `src/components/admin/admin.module.css`

**Interfaces:**
- Pages consume `getAdminProductionRuntime` and role-safe projections.
- Client forms submit idempotent same-origin API mutations.

- [ ] Write failing navigation, finance-redaction and manual-form tests.
- [ ] Run tests and confirm missing UI behavior.
- [ ] Implement list, new and detail pages with existing admin components/tokens.
- [ ] Add responsive styles without changing the storefront design system.
- [ ] Run component/page tests.

### Task 6: Migration, regression and browser verification

**Files:**
- Modify only files required by defects found during verification.

**Interfaces:**
- Uses the official local origin `http://192.168.4.199:3000`.

- [ ] Apply the migration to the configured local database.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run lint`.
- [ ] Run focused production-job tests and the complete suite serially.
- [ ] Run `npm run build` without disrupting the port-3000 development server.
- [ ] Verify list, manual creation, detail, staff finance redaction and web-order auto-linking in the real browser at mobile and desktop widths.
- [ ] Inspect `git diff --check`, `git diff --stat` and `git status --short`.
