# Card and Afterpay Only Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Zip from every active payment surface and add a database migration command that cannot select a target from residual `DATABASE_URL` state.

**Architecture:** Narrow the shared payment contract to Card/Stripe and Afterpay while retaining the existing Payment Target, Payment Attempt, ledger, return, webhook and reconciliation architecture. Tighten database checks in a new non-destructive `0033` migration, and route all migrations through a repository-owned command that selects either `TEST_DATABASE_URL` or `PRODUCTION_DATABASE_URL` explicitly and verifies safe database identity before invoking Drizzle.

**Tech Stack:** Next.js App Router, TypeScript, Zod, Drizzle ORM/Kit, PostgreSQL, Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-18-card-afterpay-only-payments-design.md`

## Global Constraints

- Supported payment methods are exactly `card` and `afterpay`.
- Zip is not a disabled future feature and must not remain in any active provider path.
- Do not alter Payment Target, immutable ledger, balance locking, idempotency, token or `manage_payment` behavior.
- Do not rewrite or delete historical orders or payments.
- Production has zero Zip attempts at the design checkpoint.
- `0031_cultured_human_torch` and `0032_sad_maria_hill` are already applied to Production; never rollback or manually re-run them.
- Do not connect to or mutate Production during implementation.
- No provider session and no real payment may be created.
- Do not push or deploy Production.

---

### Task 1: Add the explicit database migration safety boundary

**Files:**
- Create: `scripts/migration-safety.ts`
- Create: `scripts/migration-safety.test.ts`
- Create: `scripts/migrate-database.ts`
- Create: `scripts/migrate-database.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `selectMigrationTarget(input): SelectedMigrationTarget` that reads only `TEST_DATABASE_URL` for test and only `PRODUCTION_DATABASE_URL` for Production.
- Produces: `verifyDatabaseIdentity(expected, actual)` that returns safe identity or throws.
- Produces: `sanitizedMigrationEnvironment(processEnv, selectedUrl)` that deletes inherited `DATABASE_URL` and installs only the verified selected URL.
- Produces: CLI `npm run db:migrate -- --environment <test|production> ...`.

- [ ] **Step 1: Write failing target-selection tests**

Add tests proving the selected URL never comes from residual `DATABASE_URL`:

```ts
it("uses only TEST_DATABASE_URL for an explicit test migration", () => {
  const target = selectMigrationTarget({
    environment: "test",
    env: {
      DATABASE_URL: "postgresql://wrong/prod",
      TEST_DATABASE_URL: "postgresql://safe/rnr_gallery_test",
    },
  });
  expect(target.url).toContain("rnr_gallery_test");
});

it("refuses production without PRODUCTION_DATABASE_URL and confirmation", () => {
  expect(() => selectMigrationTarget({
    environment: "production",
    confirmProduction: false,
    env: { DATABASE_URL: "postgresql://wrong/prod" },
  })).toThrow();
});
```

Also assert test database naming, test/production URL inequality, required
Production database name, required SHA-256 host fingerprint and safe output
fields.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm test -- --run scripts/migration-safety.test.ts scripts/migrate-database.test.ts
```

Expected: FAIL because the modules and guarded CLI do not exist.

- [ ] **Step 3: Implement pure selection and identity guards**

In `scripts/migration-safety.ts`, parse the two explicit environment names,
validate PostgreSQL URLs without logging them, hash the hostname with SHA-256,
and return only:

```ts
type SafeDatabaseIdentity = Readonly<{
  environment: "test" | "production";
  database: string;
  hostFingerprint: string;
  serverVersion: string;
  inRecovery: boolean;
}>;
```

Require a test marker in the database name. For Production, require
`--confirm-production`, exact database name and exact host fingerprint.

- [ ] **Step 4: Implement the guarded runner**

In `scripts/migrate-database.ts`:

1. parse strict CLI arguments;
2. select the URL through `selectMigrationTarget`;
3. connect with `pg`, query database/server/recovery identity without printing
   credentials;
4. verify identity;
5. call local Drizzle Kit with a child environment built by
   `sanitizedMigrationEnvironment`;
6. propagate a non-zero child exit code.

Change `package.json` so `db:migrate` calls this runner instead of invoking
`drizzle-kit migrate` directly.

- [ ] **Step 5: Verify GREEN and guard mutation checks**

Run:

```bash
npm test -- --run scripts/migration-safety.test.ts scripts/migrate-database.test.ts
npm run typecheck
```

Temporarily replace residual `DATABASE_URL` with a deliberately different
non-secret placeholder in the test fixture and confirm selection remains the
explicit target. Do not invoke Production migration.

- [ ] **Step 6: Commit Task 1**

```bash
git add package.json scripts/migration-safety.ts scripts/migration-safety.test.ts scripts/migrate-database.ts scripts/migrate-database.test.ts
git commit -m "feat: guard database migration targets"
```

---

### Task 2: Narrow payment persistence to Card and Afterpay

**Files:**
- Modify: `src/server/db/schema/payments.ts`
- Modify: `src/server/db/schema/payment-schema.integration.test.ts`
- Modify: `src/server/payment-requests/input-schema.ts`
- Modify: `src/server/payment-requests/input-schema.test.ts`
- Modify: `src/server/payment-requests/drizzle-payment-request-repository.integration.test.ts`
- Create: generated `drizzle/0033_*.sql`
- Modify: generated `drizzle/meta/_journal.json`
- Create: generated `drizzle/meta/0033_snapshot.json`

**Interfaces:**
- Produces: `PaymentProviderKey = "stripe" | "afterpay" | "local-test"`.
- Produces: `PaymentMethodKey = "card" | "afterpay"`.
- Preserves: `payment_attempts_exactly_one_target` and all ledger constraints.

- [ ] **Step 1: Write failing schema/input tests**

Add assertions that:

```ts
expect(createPaymentRequestInputSchema.safeParse({
  ...validRequest,
  enabledPaymentMethods: ["zip"],
}).success).toBe(false);

expect(standalonePayerInputSchema.safeParse({
  ...validPayer,
  method: "zip",
}).success).toBe(false);
```

Add database tests proving `payment_requests.enabled_payment_methods` and new
Payment Attempts reject Zip while Card/Stripe, Afterpay/Afterpay and local-test
Card/Afterpay remain valid.

- [ ] **Step 2: Run tests and verify RED**

```bash
set -a
source ../payment-adapters/.env.local
set +a
npm test -- --run src/server/payment-requests/input-schema.test.ts src/server/db/schema/payment-schema.integration.test.ts
```

Expected: Zip inputs still pass or the old database constraints still permit
them.

- [ ] **Step 3: Narrow TypeScript, Zod and Drizzle checks**

Remove Zip from method/provider unions and from Payment Request and Payment
Attempt check expressions. Keep `local-test` restricted to Card or Afterpay.
Do not change amount, target, token, balance, ledger or idempotency definitions.

- [ ] **Step 4: Generate and inspect migration 0033**

```bash
npm run db:generate -- --name remove_zip_payment_provider
```

Inspect the SQL. It may drop and recreate only the Zip-related provider/method
check constraints. It must not delete rows, update orders, alter amounts,
change ledger entries or recreate `0031`/`0032` objects.

- [ ] **Step 5: Apply 0033 only to the isolated test database**

First prove `TEST_DATABASE_URL` is named as a test database and differs from
the Production URL without printing either. Then run:

```bash
npm run db:migrate -- --environment test
```

Expected: `0033` applies to the isolated test database. Do not define
`PRODUCTION_DATABASE_URL` and do not run Production mode.

- [ ] **Step 6: Verify GREEN**

```bash
npm test -- --run src/server/payment-requests/input-schema.test.ts src/server/db/schema/payment-schema.integration.test.ts src/server/payment-requests/drizzle-payment-request-repository.integration.test.ts
npm run db:check
npm run typecheck
```

- [ ] **Step 7: Commit Task 2**

```bash
git add src/server/db/schema/payments.ts src/server/db/schema/payment-schema.integration.test.ts src/server/payment-requests/input-schema.ts src/server/payment-requests/input-schema.test.ts src/server/payment-requests/drizzle-payment-request-repository.integration.test.ts drizzle
git commit -m "feat: restrict payments to card and afterpay"
```

---

### Task 3: Delete the Zip provider and registration paths

**Files:**
- Delete: `src/server/payments/zip-provider.ts`
- Delete: `src/server/payments/zip-provider.test.ts`
- Modify: `src/server/payments/config.ts`
- Modify: `src/server/payments/config.test.ts`
- Modify: `src/server/payments/provider-registry.ts`
- Modify: `src/server/payments/provider-registry.test.ts`
- Modify: `src/server/payments/eligibility.ts`
- Modify: `src/server/payments/eligibility.test.ts`
- Modify: `src/server/payments/local-test-provider.ts`
- Modify: `src/server/payments/local-test-provider.test.ts`
- Modify: `src/server/payments/payment-service.ts`
- Modify: `src/server/payments/payment-service.test.ts`
- Modify: `src/server/payments/drizzle-payment-repository.ts`
- Modify: `src/server/payments/drizzle-payment-repository.integration.test.ts`
- Modify: `src/server/admin/admin-system-status.ts`
- Modify: `src/server/admin/admin-dashboard-service.ts`

**Interfaces:**
- `parsePaymentConfig()` returns Stripe, Afterpay, local-test and operations
  configuration only.
- `selectPaymentProviders()` returns only Card and Afterpay registrations.
- Reconciliation continues to operate through the same generic provider
  interface.

- [ ] **Step 1: Write failing provider-boundary tests**

Add assertions that the exact configuration and registration keys omit Zip,
even when the input environment contains `ZIP_*` values:

```ts
expect(Object.keys(parsePaymentConfig(env))).toEqual([
  "stripe", "afterpay", "localTest", "operations",
]);
expect(selectPaymentProviders(config).map((item) => item.method))
  .toEqual(["card", "afterpay"]);
```

Add a reconciliation test that only Stripe and Afterpay attempts are selected
through supported provider registrations.

- [ ] **Step 2: Run tests and verify RED**

```bash
npm test -- --run src/server/payments/config.test.ts src/server/payments/provider-registry.test.ts src/server/payments/eligibility.test.ts src/server/payments/local-test-provider.test.ts src/server/payments/payment-service.test.ts
```

Expected: configuration, registry or local-test methods still contain Zip.

- [ ] **Step 3: Remove Zip-specific production code**

Delete the adapter and remove Zip parsing, eligibility, factories, labels,
service branches and repository special cases. Retain shared provider HTTP and
generic service code used by Stripe or Afterpay.

- [ ] **Step 4: Remove obsolete Zip-only tests and preserve regressions**

Delete Zip adapter tests. Replace multi-provider parameterized assertions with
Card/Afterpay assertions. Preserve idempotency, return, reconciliation,
provider mismatch and failure-sanitization coverage.

- [ ] **Step 5: Verify GREEN**

```bash
npm test -- --run src/server/payments
npm run typecheck
```

- [ ] **Step 6: Commit Task 3**

```bash
git add src/server/payments src/server/admin/admin-system-status.ts src/server/admin/admin-dashboard-service.ts
git commit -m "refactor: remove zip payment provider"
```

---

### Task 4: Reject Zip at checkout, Payment Request, return and UI boundaries

**Files:**
- Modify: `src/app/api/orders/[orderNumber]/payment/route-handler.ts`
- Modify: `src/app/api/orders/[orderNumber]/payment/route.test.ts`
- Modify: `src/app/api/payments/returns/[provider]/route-handler.ts`
- Modify: `src/app/api/payments/returns/[provider]/route.test.ts`
- Modify: `src/app/api/payments/webhooks/[provider]/route.test.ts`
- Modify: `src/components/payment-methods.tsx`
- Modify: `src/components/payment-methods.test.tsx`
- Modify: `src/components/checkout-view.tsx`
- Modify: `src/components/checkout-view.test.tsx`
- Modify: `src/components/payment-recovery-intent.ts`
- Modify: `src/components/payment-recovery-intent.test.ts`
- Modify: `src/components/order-payment-panel.tsx`
- Modify: `src/components/order-payment-panel.test.tsx`
- Modify: `src/components/payment-request-form.tsx`
- Modify: `src/components/payment-request-view.test.tsx`
- Modify: `src/components/admin/payment-request-form.tsx`
- Modify: `src/components/admin/payment-request-form.test.tsx`
- Modify: `src/app/admin/payment-requests/[requestId]/page.tsx`
- Modify: `src/app/admin/payment-requests/[requestId]/page.test.tsx`
- Modify: `src/app/admin/settings/page.tsx`
- Modify: `src/components/order-detail.tsx`
- Modify: `src/server/admin/drizzle-admin-order-repository.ts`
- Modify: `src/domain/analytics/events.ts`

**Interfaces:**
- Public and Admin method selectors expose exactly Card and Afterpay.
- Both normal-order and Payment Request APIs reject forged `method: "zip"`
  before payment service invocation.
- Return route accepts Stripe, Afterpay and non-production local-test only.

- [ ] **Step 1: Write failing API and rendering tests**

Add explicit forged-input tests:

```ts
const orderResponse = await handler(request({
  ...validBody,
  method: "zip",
}), context);
expect(orderResponse.status).toBe(400);
expect(paymentService.start).not.toHaveBeenCalled();

const requestResponse = await route.POST(request({
  method: "zip",
  fullName: "Customer",
  email: "payer@example.test",
  idempotencyKey: "public-payment-zip",
}), { params: Promise.resolve({ token }) });
expect(requestResponse.status).toBe(400);
expect(start).not.toHaveBeenCalled();
```

In the existing return-route test helper, call the handler with
`params: Promise.resolve({ provider: "zip" })` and assert status 404 before the
payment service reads or consumes the body. Render checkout, Admin Payment
Request and `PaymentRequestView` fixtures and assert there is no Zip option or
Zip copy while Card and Afterpay remain.

- [ ] **Step 2: Run tests and verify RED**

```bash
npm test -- --run src/app/api/orders/'[orderNumber]'/payment/route.test.ts src/app/api/payment-requests/'[token]'/payment/route.test.ts src/app/api/payments/returns/'[provider]'/route.test.ts src/components/payment-methods.test.tsx src/components/checkout-view.test.tsx src/components/payment-request-view.test.tsx src/components/admin/payment-request-form.test.tsx
```

Expected: at least the forged Zip request or existing Zip UI branch fails the
new expectation.

- [ ] **Step 3: Narrow API and UI branches**

Change strict schemas and runtime method sets to Card/Afterpay. Remove Zip
labels, address branches, button copy, recovery parsing and Admin selection.
Keep Afterpay address requirements and Card no-address behavior unchanged.

- [ ] **Step 4: Narrow analytics labels**

Change analytics `payment_type` to `"card" | "afterpay"`. Do not change event
names, item data, attribution or privacy allowlists.

- [ ] **Step 5: Verify GREEN**

```bash
npm test -- --run src/app/api/orders/'[orderNumber]'/payment src/app/api/payment-requests src/app/api/payments/returns src/app/api/payments/webhooks src/components/payment-methods.test.tsx src/components/checkout-view.test.tsx src/components/payment-recovery-intent.test.ts src/components/order-payment-panel.test.tsx src/components/payment-request-view.test.tsx src/components/admin/payment-request-form.test.tsx
npm run typecheck
```

- [ ] **Step 6: Commit Task 4**

```bash
git add src/app src/components src/domain/analytics/events.ts src/server/admin/drizzle-admin-order-repository.ts
git commit -m "fix: reject zip across payment surfaces"
```

---

### Task 5: Remove Zip configuration and current documentation

**Files:**
- Modify: `.env.example`
- Modify: `docs/payments/payment-requests.md`
- Modify: `docs/payments/payment-requests-verification-2026-08-18.md`
- Modify: `docs/google-ads-readiness-code.md`
- Modify: `docs/superpowers/specs/2026-08-18-payment-requests-design.md`
- Modify: `docs/superpowers/plans/2026-08-18-payment-requests.md`

**Interfaces:**
- Current operator documentation names only Card and Afterpay.
- Historical design/audit documents remain historical evidence and are not
  silently rewritten.

- [ ] **Step 1: Add a failing active-reference audit**

Run a scoped audit over runtime, configuration and current operator documents:

```bash
rg -n '\bZip\b|\bzip\b|ZIP_' src scripts .env.example \
  docs/payments docs/google-ads-readiness-code.md \
  docs/superpowers/specs/2026-08-18-payment-requests-design.md \
  docs/superpowers/plans/2026-08-18-payment-requests.md
```

Expected: FAIL because active references remain.

- [ ] **Step 2: Remove current references**

Delete `ZIP_*` examples and rewrite current product/operator text to say Card
and Afterpay. In the older Payment Request spec and plan, add a prominent
superseded-provider note or update provider lists so they cannot be mistaken
for current support.

- [ ] **Step 3: Re-run the reference audit**

Expected remaining references are limited to:

- old immutable migrations/snapshots;
- historical audit/spec records explicitly outside current operator scope;
- this approved removal spec and implementation plan where Zip is described as
  removed;
- regression tests whose assertion proves forged Zip input is rejected.

Every remaining runtime reference is a failure.

- [ ] **Step 4: Commit Task 5**

```bash
git add .env.example docs
git commit -m "docs: remove zip from supported payments"
```

---

### Task 6: Run the corrected Pre-deployment Gate

**Files:**
- Modify: `docs/payments/payment-requests-verification-2026-08-18.md`

**Interfaces:**
- Produces: a final evidence record and `READY TO DEPLOY` or `NOT READY`.
- Provider Gate evaluates only Stripe Card and Afterpay.

- [ ] **Step 1: Verify the release boundary**

```bash
git status --short
git rev-parse HEAD
git diff --check 3af1529..HEAD
git diff --name-only 3af1529..HEAD
```

Confirm no `.env`, secret, credential or temporary file is committed.

- [ ] **Step 2: Verify Production remains unchanged**

Use read-only database access to confirm:

- Production journal still contains complete `0031` and `0032` only;
- `0033` is pending;
- Zip attempts remain zero;
- current indexes and constraints remain valid.

Do not run the Production migration command.

- [ ] **Step 3: Run focused payment regression against the isolated test database**

After verifying the test database name and inequality without printing URLs:

```bash
npm test -- --run src/server/payment-requests src/server/payments \
  src/app/api/payment-requests src/app/api/admin/payment-requests \
  src/app/api/orders/'[orderNumber]'/payment \
  src/app/api/payments/returns src/app/api/payments/webhooks \
  src/components/payment-methods.test.tsx src/components/checkout-view.test.tsx \
  src/components/payment-request-view.test.tsx
```

Confirm Card and Afterpay normal checkout, Payment Request, existing-order
payment, webhook, reconciliation and immutable ledger coverage pass.

- [ ] **Step 4: Run the complete database-backed suite**

```bash
set -a
source ../payment-adapters/.env.local
set +a
export DATABASE_URL="$TEST_DATABASE_URL"
npm test -- --run
```

The preceding guard must prove the test database is isolated and differs from
Production. Any payment test failure is a release failure.

- [ ] **Step 5: Run static and build verification**

```bash
npm run typecheck
npm run lint
npm run db:check
npm run build
git diff --check 3af1529..HEAD
```

Use only the isolated test database and non-sensitive build-only auth values
for the build.

- [ ] **Step 6: Update the verification record**

Record exact commit, migration state, test counts, build page count, current
Production commit, safe migration command, rollback plan, skipped real-payment
checks and remaining risks. Remove missing Zip configuration from the Gate;
evaluate only Stripe Card and Afterpay.

- [ ] **Step 7: Commit Task 6**

```bash
git add docs/payments/payment-requests-verification-2026-08-18.md
git commit -m "docs: record card and afterpay release gate"
```

- [ ] **Step 8: Stop at the release boundary**

Report `READY TO DEPLOY` only if every remaining Gate passes. Do not push,
deploy, migrate Production or create a real payment without a new explicit
instruction.
