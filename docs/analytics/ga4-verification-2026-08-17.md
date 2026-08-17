# GA4 ecommerce verification — 2026-08-17

## Scope and status

This record covers the GA4 ecommerce changes on `feat/ga4-ecommerce` before
deployment. Automated source, type, lint, executable non-database test, build,
and release-boundary checks are recorded below. Production deployment,
production browser/network inspection, GA4 Realtime, GA4 DebugView, NZD/AUD
payload observation, and live purchase confirmation remain **pending**.

The first non-database run did not have `TEST_DATABASE_URL`; the isolated test
database was subsequently verified and the 18 required database suites passed.
No application, staging, or production database was used as a substitute.

## Automated checks

| Command | Result | Evidence |
| --- | --- | --- |
| `npm run typecheck` | PASS | Exit 0. |
| `npm run lint` | PASS | Exit 0. |
| Initial `npm test -- --run` | Historical preflight result | Exit 1 because 18 database suites required an absent `TEST_DATABASE_URL`; 278 files and 1,855 tests passed before those setup failures. |
| `set -a; source /Users/ronnieli/Documents/海报制作/rnr-next-platform/.worktrees/payment-adapters/.env.local; set +a; npm test -- --run` | PASS | Exit 0: 296 test files and 1,944 tests passed in 232.45s. The environment file was sourced only into that shell; no values were printed. |
| `npm test -- --run --exclude '**/*.integration.test.ts' --exclude 'src/server/addresses/drizzle-address-repository.test.ts' --exclude 'src/server/checkout/drizzle-checkout-repository.test.ts'` | PASS | Exit 0: 278 test files and 1,855 tests passed. This is the complete executable non-database suite. |
| Dedicated database suite listed below | PASS | The safe gate confirmed only these labels: `TEST_DATABASE_URL` present, PostgreSQL, separately test-named, and different from `DATABASE_URL`. Exit 0: 18 test files and 89 tests passed in 97.72s. No URL, host, user, password, or database name was printed. |
| `DATABASE_URL='postgresql://build:build@127.0.0.1:1/rnr_build' BETTER_AUTH_SECRET='<build-only non-secret>' BETTER_AUTH_URL='https://build.invalid' npm run build` | PASS | Exit 0. The build generated 89/89 static pages. The loopback database URL and auth values were build-only placeholders; no external service was contacted. |
| `git diff --check` | PASS | Exit 0; no whitespace errors. |

The exact full-suite command above supersedes the initial missing-environment
preflight result. It is the fresh complete test result: 296 files and 1,944
tests passed in 232.45 seconds.

For a separately reproducible database-only check, the following non-secret
command was run. It references the approved environment file but does not print
or copy its contents:

```bash
node --env-file=/Users/ronnieli/Documents/海报制作/rnr-next-platform/.worktrees/payment-adapters/.env.local node_modules/vitest/vitest.mjs --run \
  src/app/api/checkout/order/route.integration.test.ts \
  src/server/admin/admin-customer-service.integration.test.ts \
  src/server/admin/admin-user-service.integration.test.ts \
  src/server/admin/product-registry-service.integration.test.ts \
  src/server/db/schema/checkout-schema.integration.test.ts \
  src/server/db/schema/gallery-schema.integration.test.ts \
  src/server/db/schema/payment-schema.integration.test.ts \
  src/server/forms/drizzle-forms-stats-repository.integration.test.ts \
  src/server/forms/drizzle-forms-workbench-repository.integration.test.ts \
  src/server/gallery/drizzle-gallery-repository.integration.test.ts \
  src/server/invoices/drizzle-invoice-repository.integration.test.ts \
  src/server/orders/drizzle-order-repository.integration.test.ts \
  src/server/payments/drizzle-payment-repository.integration.test.ts \
  src/server/production/customer-proof-flow.integration.test.ts \
  src/server/production/drizzle-production-job-repository.integration.test.ts \
  src/server/uploads/abandoned-upload-cleanup.integration.test.ts \
  src/server/addresses/drizzle-address-repository.test.ts \
  src/server/checkout/drizzle-checkout-repository.test.ts
```

The first build attempt used an HTTP build-only `BETTER_AUTH_URL` and was
correctly rejected by the production-only HTTPS validation. Re-running with the
HTTPS placeholder above then exposed the required `DATABASE_URL`; supplying the
non-routable loopback placeholder produced the recorded successful build. No
source change was required.

## Tag and privacy audit

Ran:

```bash
rg -n "G-[A-Z0-9]+|GoogleAnalytics|GoogleTagManager|gtag\\.js|googletagmanager\\.com" src package.json package-lock.json
rg -n "fullName|email|phone|street|postcode|uploadReferences|imageUrl|designText|notes" src/domain/analytics src/components/analytics-event-tracker.tsx src/components/purchase-tracker.tsx
```

Results:

- `src/domain/analytics/runtime.ts` contains the sole Measurement ID constant:
  `G-RE5Z5B58TJ`.
- `src/app/layout.tsx` contains one conditional root `GoogleAnalytics` render.
  There is no Google Tag Manager, manual `gtag.js`, or `googletagmanager.com`
  source match.
- Privacy-field matches are restricted to negative privacy assertions and test
  fixtures in `src/domain/analytics/*.test.ts`. The analytics event builders and
  emitted event types contain no `fullName`, email, phone, street, postcode,
  upload reference, image URL, design text, or notes payload fields.

## Release boundary

Compared `73ab97aae85aa354adec00946d2fe52e72e3de6e..HEAD`.

- The candidate contains the GA4 plan/spec, `@next/third-parties` dependency,
  analytics runtime/builders/transport, product/cart/checkout/purchase
  instrumentation, and focused tests.
- `banner-bundle-configurator.tsx` and its test are within the live Banner
  Bundle scope only to emit the same fail-open `add_to_cart` event and verify
  that no customisation or upload data reaches analytics. They are not a Banner
  Bundle migration.
- No unrelated files or uncommitted changes existed before this record was
  added.

### Auditable boundary snapshot

The following was captured immediately before this documentation update, at
`bd519b7`:

```text
bd519b7 docs: add GA4 database verification
ba38a07 docs: record GA4 ecommerce verification
fddeaf3 feat: track GA4 checkout funnel
0c2a86f fix: keep cart analytics fail-open
e6a39db feat: track GA4 product and cart actions
c0a75e2 fix: retry purchase analytics readiness
206d1a4 fix: harden GA4 transport boundary
30942ab feat: add privacy-safe GA4 ecommerce events
c5933f3 feat: load GA4 only in production
5ada25d docs: rebase GA4 plan on banner bundle production
86b1d66 docs: plan GA4 ecommerce integration
4c91fd9 docs: define GA4 ecommerce integration
```

```text
A docs/analytics/ga4-verification-2026-08-17.md
A docs/superpowers/plans/2026-08-17-ga4-ecommerce.md
A docs/superpowers/specs/2026-08-17-ga4-ecommerce-design.md
M package-lock.json
M package.json
A src/app/au/products/[slug]/page.test.tsx
M src/app/au/products/[slug]/page.tsx
M src/app/layout.test.ts
M src/app/layout.tsx
M src/app/products/[slug]/page-content.tsx
M src/app/products/[slug]/page.test.tsx
A src/components/analytics-event-tracker.test.tsx
A src/components/analytics-event-tracker.tsx
M src/components/banner-bundle-configurator.test.tsx
M src/components/banner-bundle-configurator.tsx
M src/components/cart-view.test.tsx
M src/components/cart-view.tsx
M src/components/checkout-view.test.tsx
M src/components/checkout-view.tsx
M src/components/product-configurator.test.tsx
M src/components/product-configurator.tsx
M src/components/purchase-tracker.test.tsx
M src/components/purchase-tracker.tsx
M src/components/stripe-payment-form.test.tsx
M src/components/stripe-payment-form.tsx
A src/domain/analytics/client.test.ts
A src/domain/analytics/client.ts
M src/domain/analytics/events.test.ts
M src/domain/analytics/events.ts
A src/domain/analytics/runtime.test.ts
A src/domain/analytics/runtime.ts
```

## Pending controller-owned evidence

The following must be appended after the exact verified commit is deployed:

- Vercel Ready deployment ID, source revision, and production alias.
- Production DOM/network proof that `G-RE5Z5B58TJ` loads once, plus preview
  proof that the tag and ecommerce emission are disabled.
- Production browser evidence for `view_item`, `add_to_cart`,
  `remove_from_cart`, `view_cart`, `begin_checkout`, `add_shipping_info`,
  `add_payment_info`, and `purchase` in both GA4 Realtime and DebugView.
- Observed NZD and AUD values/items, a stable purchase transaction ID, and a
  production payload privacy check.
- Confirmation that `?ga_debug=0` removes debug mode.

Until the production checks above are completed, this record is not
production-release evidence.
