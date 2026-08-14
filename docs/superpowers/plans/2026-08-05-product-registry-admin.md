# Product Registry Administration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one versioned product registry authoritative for storefront display, configuration previews and checkout repricing, with safe administrator publication.

**Architecture:** Preserve immutable product/workflow structure in code, store a complete validated mutable snapshot in PostgreSQL, and publish it atomically with optimistic concurrency, revision history and audit logging. Server pages and checkout load the same registry; client components receive an explicit snapshot-derived policy.

**Tech Stack:** Next.js 16, React 19, TypeScript, Drizzle ORM/PostgreSQL, Zod, Vitest, Testing Library

## Global Constraints

- Preserve product keys, slugs, workflow keys, category, orientation modes, delivery modes and size keys.
- Preserve historical order snapshots and never trust browser-provided prices.
- Checkout must fail closed when the authoritative registry cannot be read.
- Only `manage_prices` can publish and every mutation requires same-origin protection, idempotency, version checking and audit logging.
- Do not refactor unrelated storefront, payment, shipping, gallery or production behavior.

---

### Task 1: Registry domain model

**Files:**
- Create: `src/domain/catalogue/product-registry.ts`
- Create: `src/domain/catalogue/product-registry.test.ts`
- Modify: `src/domain/configuration/quote.ts`
- Modify: `src/domain/pricing/people-fees.ts`
- Modify: `src/domain/scheduling/urgent-service.ts`

**Interfaces:**
- Produces: `ProductRegistryDocument`, `defaultProductRegistry`, `parseProductRegistry`, `productFromRegistry`, `schemaFromRegistry`, and explicit pricing-policy inputs for quotes and urgent dates.

- [ ] Write tests proving defaults preserve every current product, starting prices derive from size minima, malformed or structurally changed documents fail, and custom fee schedules affect quotes.
- [ ] Run the focused tests and confirm they fail because the registry API does not exist.
- [ ] Implement the minimal immutable registry model and explicit policy parameters.
- [ ] Run the focused tests and existing pricing/configuration/scheduling tests.

### Task 2: Versioned persistence and publication

**Files:**
- Modify: `src/server/db/schema/admin.ts`
- Modify: `src/server/db/schema/index.ts`
- Generate: `drizzle/0014_*.sql`
- Generate: `drizzle/meta/0014_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Create: `src/server/admin/product-registry-service.ts`
- Create: `src/server/admin/product-registry-service.test.ts`
- Create: `src/server/admin/product-registry-runtime.ts`

**Interfaces:**
- Produces: `getPublishedRegistry()`, `publishProductPatch()`, `publishPricingPolicyPatch()`, version-conflict and validation errors.

- [ ] Write failing service tests for version zero, atomic publication, duplicate idempotency and stale-version rejection.
- [ ] Add current-state and immutable-revision tables.
- [ ] Implement transactional publication with an advisory lock, full-document validation and audit records.
- [ ] Run service, schema and migration checks.

### Task 3: Authoritative checkout and storefront reads

**Files:**
- Modify: `src/domain/checkout/reprice-cart.ts`
- Modify: `src/server/checkout/checkout-service.ts`
- Modify: `src/app/api/checkout/session/route.ts`
- Modify: `src/components/product-configurator.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/shop/page.tsx`
- Modify: `src/app/canvas/page.tsx`
- Modify: `src/app/banners/page.tsx`
- Modify: `src/app/products/[slug]/page.tsx`
- Modify: `src/app/products/[slug]/configure/page.tsx`
- Modify: `src/app/product/[slug]/page.tsx`
- Modify: `src/server/admin/admin-dashboard-service.ts`
- Modify: `src/components/admin/production-job-form.tsx`
- Modify: `src/app/admin/jobs/new/page.tsx`

**Interfaces:**
- Consumes: active `ProductRegistryDocument` from Task 2.
- Produces: identical snapshot-derived values in public presentation, browser quote preview and server checkout authority.

- [ ] Add failing tests demonstrating a registry price/fee change reaches configuration and server repricing while a tampered browser price is ignored.
- [ ] Inject the active registry through server boundaries and client props.
- [ ] Remove direct baseline imports from runtime paths listed above.
- [ ] Run checkout, catalogue, configurator, page and production-form tests.

### Task 4: Protected administrator editor

**Files:**
- Create: `src/app/api/admin/products/[productKey]/route.ts`
- Create: `src/app/api/admin/products/[productKey]/route.test.ts`
- Create: `src/app/api/admin/products/pricing-policy/route.ts`
- Create: `src/app/api/admin/products/pricing-policy/route.test.ts`
- Create: `src/components/admin/product-registry-form.tsx`
- Create: `src/components/admin/product-registry-form.test.tsx`
- Modify: `src/app/admin/products/page.tsx`
- Modify: `src/app/admin/products/page.test.tsx`
- Modify: `src/components/admin/admin.module.css`

**Interfaces:**
- Consumes: publication methods and version from Task 2.
- Produces: same-origin, admin-only product and store-wide policy publication controls.

- [ ] Write failing route and component tests for permissions, origin checking, confirmation, error feedback and refreshed version.
- [ ] Implement minimal mutation routes with failure auditing and no-store responses.
- [ ] Replace the read-only warning with clear per-product and global fee editors while retaining tax labels and immutable IDs.
- [ ] Run all admin product and permission tests.

### Task 5: Full verification

**Files:**
- Modify only defects directly exposed by verification.

**Interfaces:**
- Verifies the complete product-registry boundary.

- [ ] Run focused tests for registry, pricing, checkout, product pages and admin routes/components.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm run test:run`, `npm run db:check`, and `npm run build`.
- [ ] Apply the new migration to the current local database without changing existing order snapshots.
- [ ] In a real browser on `http://192.168.4.199:3000`, publish a reversible test price, verify shop/product/configurator/cart/checkout/admin consistency, restore the original value through the same audited editor, and confirm no console errors.
- [ ] Run `git diff --check` and report every changed file without committing.
