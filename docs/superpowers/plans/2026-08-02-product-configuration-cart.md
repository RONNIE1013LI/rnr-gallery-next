# Product Configuration and Cart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authoritative configuration schemas, a guided configurator and a persistent guest cart for all seven R&R products.

**Architecture:** Framework-independent configuration and cart modules own validation, quoting and immutable snapshots. Client components render schemas and persist only versioned cart data; price calculations remain outside React.

**Tech Stack:** Next.js App Router, React 19, TypeScript, CSS Modules, Vitest, React Testing Library and browser acceptance.

## Global Constraints

- Work only in `/Users/ronnieli/Documents/海报制作/rnr-next-platform`.
- Do not modify `../rnr-wordpress-staging`.
- Money remains integer NZD cents; GST is 15 percent.
- The server/domain layer is authoritative for prices.
- Delivery defaults to `post`; allowed values are `post` and `pickup`.
- Minimum supported viewport is 390px.

---

### Task 1: Product configuration schemas

**Files:**
- Create: `src/domain/configuration/types.ts`
- Create: `src/domain/configuration/schemas.ts`
- Test: `src/domain/configuration/schemas.test.ts`

**Interfaces:**
- Produces: `getConfigurationSchema(productKey: string): ProductConfigurationSchema | undefined`.
- `ProductConfigurationSchema` exposes ordered size options, orientation mode, people/pets mode and default values.

- [ ] Write failing tests asserting seven schemas, exact sizes/defaults, fixed orientations and `post` delivery.
- [ ] Run `npm run test:run -- src/domain/configuration/schemas.test.ts` and verify missing-module failure.
- [ ] Implement immutable schemas with no React dependencies.
- [ ] Re-run the test and commit `feat: add product configuration schemas`.

### Task 2: Configuration quote domain

**Files:**
- Create: `src/domain/configuration/quote.ts`
- Test: `src/domain/configuration/quote.test.ts`
- Modify: `src/domain/pricing/types.ts`

**Interfaces:**
- Produces: `quoteConfiguration(schema, selection): PriceBreakdown`.
- Consumes: size price and optional people/pets count from a validated selection.

- [ ] Write failing tests for all seven valid defaults, Digital Oil A4 with one/two/six people and invalid size/count.
- [ ] Run the focused test and verify RED.
- [ ] Implement validation and quote composition using existing pricing helpers.
- [ ] Re-run pricing and quote tests; commit `feat: quote configured products`.

### Task 3: Immutable cart and versioned repository

**Files:**
- Create: `src/domain/cart/types.ts`
- Create: `src/domain/cart/cart.ts`
- Create: `src/domain/cart/browser-cart-repository.ts`
- Test: `src/domain/cart/cart.test.ts`

**Interfaces:**
- Produces: `addCartItem`, `removeCartItem`, `setCartItemQuantity`, `calculateCartTotals`.
- Produces: `createBrowserCartRepository(storage): CartRepository`.

- [ ] Write failing behavior tests for add/merge, removal, quantity, totals, round-trip persistence, corrupt JSON and version mismatch.
- [ ] Run the focused tests and verify RED.
- [ ] Implement immutable cart functions and guarded JSON parsing.
- [ ] Re-run tests and commit `feat: add persistent guest cart domain`.

### Task 4: Guided configurator and add-to-cart flow

**Files:**
- Create: `src/components/product-configurator.tsx`
- Create: `src/components/product-configurator.module.css`
- Create: `src/components/product-configurator.test.tsx`
- Create: `src/app/products/[slug]/configure/page.tsx`
- Modify: `src/app/products/[slug]/page.tsx`

**Interfaces:**
- `ProductConfigurator` consumes a product, schema and cart repository factory.
- Produces persisted cart items and accessible success feedback.

- [ ] Write failing component tests for defaults, live Digital Oil quote, people increment and add-to-cart persistence.
- [ ] Run focused tests and verify RED.
- [ ] Implement native fields, summary and local-storage persistence.
- [ ] Add the product-detail CTA and static configuration routes.
- [ ] Re-run tests, lint and types; commit `feat: add guided product configurator`.

### Task 5: Professional cart page

**Files:**
- Create: `src/components/cart-view.tsx`
- Create: `src/components/cart-view.test.tsx`
- Modify: `src/app/cart/page.tsx`
- Modify: `src/components/product-configurator.module.css`

**Interfaces:**
- `CartView` loads the repository, displays item snapshots and updates quantity/removal.

- [ ] Write failing tests for empty, populated, quantity and removal states.
- [ ] Run focused tests and verify RED.
- [ ] Implement the client cart and aligned totals summary.
- [ ] Re-run tests and commit `feat: build guest cart experience`.

### Task 6: Private upload adapter

**Files:**
- Create: `src/server/uploads/types.ts`
- Create: `src/server/uploads/local-private-upload-store.ts`
- Create: `src/app/api/uploads/route.ts`
- Test: `src/server/uploads/local-private-upload-store.test.ts`

**Interfaces:**
- Produces: `savePrivateUpload`, returning opaque ID, original display name, MIME type and bytes.
- Stores files under `.data/private-uploads`, outside `public/`.

- [ ] Write failing tests for allowed JPEG/PNG/WebP/PDF, rejected executable/oversize files and random storage names.
- [ ] Run focused tests and verify RED.
- [ ] Implement the local adapter and validated multipart route.
- [ ] Re-run tests and commit `feat: add private source-file intake`.

### Task 7: Full verification and browser acceptance

**Files:**
- Create: `docs/audits/phase-2-browser-2026-08-02/README.md`

- [ ] Run `npm run test:run`, `npm run lint`, `npm run typecheck`, `npm run build` and `git diff --check`.
- [ ] Verify product → configure → cart at 390, 820 and 1440px in a real browser.
- [ ] Confirm no horizontal overflow, zero visible broken images and cart persistence after refresh.
- [ ] Commit browser evidence as `test: record phase two browser acceptance`.
