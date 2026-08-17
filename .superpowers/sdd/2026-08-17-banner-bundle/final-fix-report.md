# Banner Bundle final fix report

Date: 2026-08-17 (Pacific/Auckland)

Worktree: `/Users/ronnieli/Documents/海报制作/rnr-next-platform/.worktrees/payment-adapters`

Branch: `feat/payment-adapters`
Starting HEAD: `c2c8491` (`fix: preserve exact banner bundle prices`)

## Status

All five final-review findings are addressed in one coherent fix wave. Automated verification passed. No production database, Blob-auth bypass, payment, carrier request, Australia enablement, deployment, or production mutation was performed.

## Finding 1 — aggregate upload limit

- Added a Bundle aggregate maximum of 100 while retaining the normal-product maximum of 50.
- The checkout input schema now applies the higher outer limit only to `banner-bundle`; authoritative component validation still limits each component to 50 and rejects invalid or duplicated grouped uploads.
- Added a real `Cart` → `cartToCheckoutInput` → `repriceCart` regression with a flattened 50 + 50 upload union.

Files:

- `src/domain/bundles/banner-bundle.ts`
- `src/domain/checkout/input-schema.ts`
- `src/domain/cart/checkout-input.test.ts`

## Finding 2 — production job instructions

- Existing production job item text fields now receive labelled projections from the immutable grouped Bundle components:
  - `Roll-Up Banner — wording`
  - `Wall Banner — wording`
  - `Roll-Up Banner — design instructions`
  - `Wall Banner — design instructions`
- The job-level design and note summaries use the same projected item text.
- The `order_items.bundle_components` JSON snapshot and flattened upload claim path are unchanged.
- Normal-product production item text remains byte-for-byte as supplied; its existing trimmed job-level summary behavior is preserved.
- Added repository, order-service path, and production-view regressions.

Files:

- `src/server/orders/drizzle-order-repository.ts`
- `src/server/orders/drizzle-order-repository.test.ts`
- `src/server/orders/order-service.test.ts`
- `src/components/admin/production-job-detail.test.tsx`

## Finding 3 — NZ catalogue exact price

- Shop and Banners now pass the Bundle's authoritative NZ inclusive starting price to its card.
- Both routes render `NZ$359.99` for the small Bundle.
- The override is scoped to Banner Bundle; normal products retain their existing lowest-size catalogue calculation.

Files:

- `src/app/shop/page.tsx`
- `src/app/shop/page.test.tsx`
- `src/app/banners/page.tsx`
- `src/app/banners/page.test.tsx`

## Finding 4 — Admin exact-gross invariant

- Removed the Bundle NZ fallback that re-grossed ex-GST cents.
- Registry parsing now rejects any Banner Bundle size without an exact NZ GST-inclusive amount.
- Admin product publication requires the exact NZ gross amount on every Bundle size and rejects omission before repository publication.
- Legacy/non-Bundle products retain the optional exact-gross behavior.
- Existing exact-price publication coverage still proves preservation of `35_999`; new tests cover synchronized-registry rejection, direct-registry rejection, and Admin omission rejection.

Files:

- `src/domain/catalogue/market-price-book.ts`
- `src/domain/catalogue/product-registry.ts`
- `src/domain/catalogue/product-registry.test.ts`
- `src/server/admin/product-registry-service.ts`
- `src/server/admin/product-registry-service.test.ts`

## Finding 5 — fixed included-photo rule and Admin controls

- Added one immutable shared rule: exactly 5 included photos per Bundle component.
- The default Bundle schema, customer configurator copy, preview counts, and authoritative server counts all derive from that rule.
- Registry parsing and Admin publication reject any different Bundle value.
- The Bundle Admin card no longer presents generic included-photo, extra-photo, or background-removal inputs. It states the fixed allowance and points staff to the standalone Roll-Up Banner and Custom Themed Wall Banner settings that supply component charges.
- Added tests for registry/Admin rejection, untrusted configurator-schema resistance, and truthful Admin presentation/payload behavior.

Files:

- `src/domain/bundles/banner-bundle.ts`
- `src/domain/configuration/schemas.ts`
- `src/components/banner-bundle-configurator.tsx`
- `src/components/banner-bundle-configurator.test.tsx`
- `src/domain/catalogue/product-registry.ts`
- `src/domain/catalogue/product-registry.test.ts`
- `src/server/admin/product-registry-service.ts`
- `src/server/admin/product-registry-service.test.ts`
- `src/components/admin/product-registry-form.tsx`
- `src/components/admin/product-registry-form.test.tsx`

## RED evidence

Initial final-fix regression command:

```bash
npm test -- --run \
  src/domain/cart/checkout-input.test.ts \
  src/server/orders/drizzle-order-repository.test.ts \
  src/server/orders/order-service.test.ts \
  src/components/admin/production-job-detail.test.tsx \
  src/app/shop/page.test.tsx \
  src/app/banners/page.test.tsx \
  src/domain/catalogue/product-registry.test.ts \
  src/server/admin/product-registry-service.test.ts \
  src/components/admin/product-registry-form.test.tsx \
  src/components/banner-bundle-configurator.test.tsx
```

Result before production changes: **RED**, exit 1; 10/10 files failed, 12 tests failed and 46 passed.

The failures matched the findings:

- 100 flattened Bundle references were rejected as an invalid checkout cart.
- Repository, service path, and production view received empty Bundle wording/notes.
- Shop and Banners rendered `NZ$359.98`, not `NZ$359.99`.
- Registry synchronization/parser and Admin publication accepted missing exact gross values.
- Registry/Admin accepted six included photos, the Admin showed misleading generic controls, and customer copy followed the untrusted value.

Two additional self-review RED checks protected existing behavior:

1. `npm test -- --run src/server/orders/drizzle-order-repository.test.ts` — **RED**, 1 failed / 4 passed because the first projection draft trimmed normal-product item text.
2. `npm test -- --run src/app/shop/page.test.tsx` — **RED**, 1 failed / 1 passed because the first catalogue draft overrode a normal product's existing lowest-size price with its default-size market quote.

Both were fixed before final verification.

## GREEN evidence

### Final-fix regression suite

The initial 10-file command above was rerun after all changes.

Result: **PASS**, 10/10 files and 59/59 tests, exit 0.

### Focused Bundle suite

```bash
npm test -- --run \
  src/domain/catalogue/catalogue.test.ts \
  src/domain/configuration/schemas.test.ts \
  src/domain/catalogue/market-price-book.test.ts \
  src/domain/catalogue/product-registry.test.ts \
  src/domain/bundles/banner-bundle.test.ts \
  src/domain/checkout/reprice-cart.test.ts \
  src/domain/pricing/market-quote.test.ts \
  src/components/banner-bundle-configurator.test.tsx \
  src/domain/cart/browser-cart-repository.test.ts \
  src/server/shipping/shipping-service.test.ts
```

Result: **PASS**, 10/10 files and 125/125 tests, exit 0.

### Supporting commerce suite

Covered Cart/checkout, registry Admin, catalogue, production job, identity, shipping, payment, analytics, merchant privacy, and the public privacy page.

Result: **PASS**, 27/27 files and 265/265 tests, exit 0.

### Full executable non-database suite

```bash
npm test -- --run \
  --exclude '**/*.integration.test.ts' \
  --exclude 'src/server/addresses/drizzle-address-repository.test.ts' \
  --exclude 'src/server/checkout/drizzle-checkout-repository.test.ts'
```

Result: **PASS**, 274/274 files and 1817/1817 tests, exit 0. Vitest emitted the same two jsdom `Not implemented: navigation to another Document` notices; there were zero failures.

### Static checks

- `npm run typecheck`: **PASS**, exit 0.
- `npm run lint`: **PASS**, exit 0.
- `git diff --check`: **PASS**, exit 0.

### Production build

```bash
BETTER_AUTH_URL=https://build.local.invalid \
BETTER_AUTH_SECRET=build-only-secret-with-32-characters \
npm run build
```

Result: **PASS**, exit 0. Next.js 16.3.0 compiled successfully, completed TypeScript, and generated 89/89 static pages. Only validation-only auth values were supplied.

## Safety and remaining concerns

- No schema or migration file changed in this fix wave.
- Database integration tests were not run; no database was contacted.
- No local browser acceptance was rerun in this fix wave. Automated route/component coverage and the production build passed.
- Blob-backed upload authentication, real Guest/User A/User B browser transitions, and the disabled AU runtime flow remain outside this fix wave's verified surfaces.
- No real payment, live carrier request, Australia enablement, deployment, or production mutation occurred.
