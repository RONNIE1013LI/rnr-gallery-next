# Production Proofing and Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the production workbench with private file/proof workflows and role-safe operations reporting.

**Architecture:** Extend the existing production schema with private file, immutable proof-review and per-user saved-view tables. Add focused services and protected routes, project them into existing Admin pages, and derive exports/reports from the same production repository so no parallel order authority is created.

**Tech Stack:** Next.js 16, React 19, TypeScript, Drizzle ORM/PostgreSQL, Zod, local private filesystem storage, Vitest and Testing Library.

## Global Constraints

- Preserve ecommerce pricing, payment, shipping, address and upload authority.
- Keep every production file outside `public/` and validate ownership before streaming bytes.
- Staff cannot access payment proofs, bulk customer exports or finance summaries.
- Proof decisions and operational guidance never change order totals automatically.
- Do not send email/push messages or import historical eTeams customer data.
- All mutations require permission, same-origin validation, idempotency where applicable and audit.

---

### Task 1: Proofing and saved-view schema

**Files:**
- Modify: `src/server/db/schema/production.ts`
- Modify: `src/server/db/schema/index.ts`
- Modify: `src/server/auth/admin-permissions.ts`
- Modify: `src/server/auth/admin-permissions.test.ts`
- Modify: `src/server/db/schema/production-schema.test.ts`
- Generate: `drizzle/0012_*.sql`

**Interfaces:**
- Produces `productionJobFiles`, `productionProofReviews`, `productionSavedViews` and focused permissions.

- [ ] Write failing schema and permission assertions for file roles, immutable reviews and per-user saved views.
- [ ] Run focused tests and confirm missing exports fail.
- [ ] Add typed tables, constraints, indexes and role mappings.
- [ ] Generate and inspect migration 0012.
- [ ] Run focused tests and `npm run db:check`.

### Task 2: Private file and proof service

**Files:**
- Create: `src/server/production/production-proof-service.ts`
- Create: `src/server/production/production-proof-service.test.ts`
- Create: `src/server/production/drizzle-production-proof-repository.ts`
- Create: `src/server/production/drizzle-production-proof-repository.integration.test.ts`

**Interfaces:**
- Produces upload metadata validation, next draft version allocation, proof decision validation, revision summaries and audited database operations.
- Consumes `LocalPrivateUploadStore` for bytes; raw storage metadata never leaves the server route layer.

- [ ] Write failing service tests for purposes, review decisions, idempotency and revision counts.
- [ ] Run tests and confirm feature-absence failures.
- [ ] Implement minimal service interfaces and errors.
- [ ] Write a failing database integration test for version allocation, finance redaction, proof immutability and audit.
- [ ] Implement repository operations and run focused tests serially.

### Task 3: Protected file and proof routes

**Files:**
- Create: `src/server/admin/admin-production-proof-runtime.ts`
- Create: `src/app/api/admin/jobs/[jobId]/files/route.ts`
- Create: `src/app/api/admin/jobs/[jobId]/files/route.test.ts`
- Create: `src/app/api/admin/jobs/[jobId]/files/[fileId]/route.ts`
- Create: `src/app/api/admin/jobs/[jobId]/files/[fileId]/route.test.ts`
- Create: `src/app/api/admin/jobs/[jobId]/proof-reviews/route.ts`
- Create: `src/app/api/admin/jobs/[jobId]/proof-reviews/route.test.ts`

**Interfaces:**
- Multipart upload stores bytes privately and associates metadata atomically with compensation on failure.
- Download authorizes job/file ownership and payment-proof finance access.
- Proof-review mutation records one immutable decision per design draft.

- [ ] Write failing route tests for authentication, origin, validation, ownership, payment-proof access and duplicates.
- [ ] Run tests and confirm missing routes fail.
- [ ] Implement routes using existing mutation and failure-audit patterns.
- [ ] Run route tests.

### Task 4: Files and proofs Admin UI

**Files:**
- Modify: `src/server/production/drizzle-production-job-repository.ts`
- Modify: `src/components/admin/production-job-detail.tsx`
- Create: `src/components/admin/production-files-panel.tsx`
- Create: `src/components/admin/production-files-panel.test.tsx`
- Modify: `src/app/admin/jobs/[jobId]/page.tsx`
- Modify: `src/components/admin/admin.module.css`

**Interfaces:**
- Detail projection returns role-safe file summaries and proof revision counts.
- Client panel uploads files and records proof decisions without exposing storage keys.

- [ ] Write failing projection/component/page tests for version labels, revision guidance and payment-proof redaction.
- [ ] Run tests and confirm missing UI fails.
- [ ] Implement repository projection, panel and responsive styles.
- [ ] Run focused tests.

### Task 5: Saved views

**Files:**
- Create: `src/server/production/production-saved-view-service.ts`
- Create: `src/server/production/production-saved-view-service.test.ts`
- Create: `src/app/api/admin/jobs/views/route.ts`
- Create: `src/app/api/admin/jobs/views/route.test.ts`
- Create: `src/app/api/admin/jobs/views/[viewId]/route.ts`
- Create: `src/app/api/admin/jobs/views/[viewId]/route.test.ts`
- Create: `src/components/admin/production-saved-views.tsx`
- Create: `src/components/admin/production-saved-views.test.tsx`
- Modify: `src/app/admin/jobs/page.tsx`

**Interfaces:**
- Stores only normalized `/admin/jobs` query strings for the current user.

- [ ] Write failing validation, ownership, route and component tests.
- [ ] Run tests and confirm missing behavior.
- [ ] Implement service, repository operations, routes and list-page controls.
- [ ] Run focused tests.

### Task 6: CSV export and production report

**Files:**
- Create: `src/server/production/production-operations-service.ts`
- Create: `src/server/production/production-operations-service.test.ts`
- Modify: `src/server/production/drizzle-production-job-repository.ts`
- Create: `src/app/api/admin/jobs/export/route.ts`
- Create: `src/app/api/admin/jobs/export/route.test.ts`
- Create: `src/app/admin/jobs/report/page.tsx`
- Create: `src/app/admin/jobs/report/page.test.tsx`
- Modify: `src/app/admin/jobs/page.tsx`
- Modify: `src/components/admin/admin.module.css`

**Interfaces:**
- Produces CSV with injection-safe cells and a 5,000-row cap.
- Produces role-safe status, attention, workload and finance report projections.

- [ ] Write failing CSV and report tests for staff finance redaction, urgency, overdue and workload totals.
- [ ] Run tests and confirm feature absence.
- [ ] Implement export/report services, repository queries, route and page.
- [ ] Run focused tests.

### Task 7: Migration and complete verification

**Files:**
- Modify only files required by verified defects.

**Interfaces:**
- Uses the official local origin `http://192.168.4.199:3000`.

- [ ] Apply migration 0012 to the configured local database.
- [ ] Run lint, typecheck and database checks.
- [ ] Run focused tests and the complete suite against a fresh isolated PostgreSQL database.
- [ ] Run a production Turbopack build from an isolated copy with an HTTPS production auth origin.
- [ ] Verify upload, proof review, saved view, export authorization and report layouts in authenticated Chrome at desktop and 390 px widths.
- [ ] Run `git diff --check`, inspect status and do not commit.
