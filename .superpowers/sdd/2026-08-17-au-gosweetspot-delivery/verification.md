# AU GoSweetSpot delivery verification

Code commit range verified: `afaad69c046bd37be9cccefde7ed2150f22f9125..5a721d2`.

## Environment safety gate

Before database-backed tests, the approved environment at
`/Users/ronnieli/Documents/海报制作/rnr-next-platform/.worktrees/payment-adapters/.env.local`
was checked without printing values:

- `TEST_DATABASE_URL` present: yes
- PostgreSQL URL: yes
- Isolated test database name: yes
- Different from `DATABASE_URL`: yes

## Focused release tests

Command (exit `0`):

```bash
npm test -- --run \
  src/domain/catalogue/market-price-book.test.ts \
  src/components/admin/product-registry-form.test.tsx \
  src/server/admin/product-registry-service.test.ts \
  src/server/shipping/gosweetspot-provider.test.ts \
  src/server/shipping/local-test-provider.test.ts \
  src/server/shipping/shipping-service.test.ts \
  src/server/shipping/package-registry.test.ts \
  src/components/product-configurator.test.tsx \
  src/components/banner-bundle-configurator.test.tsx \
  src/components/checkout-view.test.tsx \
  src/server/checkout/checkout-service.test.ts \
  src/app/api/checkout/shipping/route.test.ts \
  src/app/api/checkout/order/route.test.ts
```

Result: 13 test files passed, 185 tests passed.

Additional AU closed/noindex coverage (exit `0`):

```bash
npm test -- --run \
  src/app/au/page.test.tsx \
  src/app/au/products/'[slug]'/page.test.tsx \
  src/app/seo-routes.test.ts
```

Result: 3 test files passed, 27 tests passed. The default registry still has
`markets.AU.enabled: false`; the AU page metadata test asserts `noindex,nofollow`
while it is closed.

## Static verification

All commands exited `0`:

```bash
npm run typecheck
npm run lint
git diff --check afaad69..HEAD
```

## Complete test suite

After the safety gate, the approved isolated test environment was sourced:

```bash
TEST_ENV_PATH='/Users/ronnieli/Documents/海报制作/rnr-next-platform/.worktrees/payment-adapters/.env.local'
set -a
source "$TEST_ENV_PATH"
set +a
npm test -- --run
```

Exit `0`: 297 test files passed, 1,978 tests passed, in 217.30 seconds.

Warnings observed but not failures: the PostgreSQL driver emitted its existing
future SSL-semantics warning, and jsdom emitted existing unsupported-navigation
messages.

## Production build

The initial build using this worktree's `.env.local` exited `1` because its
local configuration did not define `BETTER_AUTH_URL`. Sourcing the existing
production environment cache next exposed a separate local-cache issue:
`BETTER_AUTH_SECRET` did not satisfy the current entropy validation. Neither
issue was changed as part of this shipping release.

The final safe build used the existing production environment cache together
with build-only, non-sensitive replacement auth values (`https` origin and a
high-entropy placeholder secret). It made no provider, shipment, payment, or
order request:

```bash
PROD_ENV_PATH='/Users/ronnieli/Documents/海报制作/rnr-next-platform/.worktrees/payment-adapters/.vercel/.env.production.local'
set -a
source "$PROD_ENV_PATH"
set +a
BETTER_AUTH_URL='https://build.local'
BETTER_AUTH_SECRET='<build-only non-sensitive placeholder>'
npm run build
```

Exit `0`: Next.js compiled, type-checked, collected route data, and generated
89 static pages.

## Limitations and release boundary

- Australia was not enabled.
- No live payment was started.
- No shipment or label was created.
- Automated provider tests used mocked GoSweetSpot responses.
- Production GoSweetSpot AU rating remains a post-deployment smoke check after the code is released while AU stays closed.
- No deployment was performed from this verification task.

## Post-review compatibility-fix verification

The final review found that existing schema-v2 registry snapshots could still
contain the legacy AU fixed shipping row. Commit `5a721d2` added an in-memory
compatibility migration that changes only that row to the carrier-backed
GoSweetSpot structure while retaining the saved NZ/AU price books, tax policy,
product configuration and disabled AU state.

Fresh verification after that fix:

- Focused registry, pricing, admin, shipping, configurator, checkout and AU
  closed/noindex coverage: exit `0`, 17 files and 226 tests passed.
- `npm run typecheck`: exit `0`.
- `npm run lint`: exit `0`.
- `git diff --check afaad69..HEAD`: exit `0`.
- Full suite with the verified isolated test database: exit `0`, 297 files and
  1,979 tests passed in 211.96 seconds.
- Production build using the same safe build-only auth overrides described
  above: exit `0`; 89 static pages generated.
- Scoped final re-review: the compatibility blocker is fixed, with no remaining
  Critical, Important or Minor finding in this feature scope.
