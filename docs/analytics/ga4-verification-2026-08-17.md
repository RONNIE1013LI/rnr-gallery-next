# GA4 ecommerce verification — 2026-08-17

## Scope and status

This record covers the GA4 ecommerce changes on `feat/ga4-ecommerce` before
deployment. Automated source, type, lint, executable non-database test, build,
and release-boundary checks are recorded below. Production deployment,
production browser/network inspection, GA4 Realtime, GA4 DebugView, NZD/AUD
payload observation, and live purchase confirmation remain **pending**.

`TEST_DATABASE_URL` was absent in this verification environment. No database
integration tests were run, and no application, staging, or production database
was used as a substitute.

## Automated checks

| Command | Result | Evidence |
| --- | --- | --- |
| `npm run typecheck` | PASS | Exit 0. |
| `npm run lint` | PASS | Exit 0. |
| `npm test -- --run` | BLOCKED | Exit 1 because 18 database suites require an absent `TEST_DATABASE_URL`; 278 files and 1,855 tests passed before those setup failures. |
| `npm test -- --run --exclude '**/*.integration.test.ts' --exclude 'src/server/addresses/drizzle-address-repository.test.ts' --exclude 'src/server/checkout/drizzle-checkout-repository.test.ts'` | PASS | Exit 0: 278 test files and 1,855 tests passed. This is the complete executable non-database suite. |
| `DATABASE_URL='postgresql://build:build@127.0.0.1:1/rnr_build' BETTER_AUTH_SECRET='<build-only non-secret>' BETTER_AUTH_URL='https://build.invalid' npm run build` | PASS | Exit 0. The build generated 89/89 static pages. The loopback database URL and auth values were build-only placeholders; no external service was contacted. |
| `git diff --check` | PASS | Exit 0; no whitespace errors. |

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

Until those checks and the isolated database integration suite are completed,
this record is not production-release evidence.
