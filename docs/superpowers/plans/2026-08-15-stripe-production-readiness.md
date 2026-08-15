# Stripe Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the known Stripe Card configuration and PaymentIntent gaps, verify the production Stripe/Webhook setup without charging a card, and prepare a controlled real-payment acceptance for the customer tomorrow.

**Architecture:** Keep the existing immutable order, payment-attempt, Stripe Elements, verified-webhook and reconciliation architecture. Add strict Stripe key-mode validation at the configuration boundary, restore an explicit Card-only PaymentIntent contract, then collect secret-safe production evidence through read-only Vercel and Stripe API checks. Deploy only the exact verified Git commit; stop before any operation that can create a real charge.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Stripe Node SDK 22, Stripe Elements, PostgreSQL, Drizzle ORM, Vitest, Testing Library, Vercel CLI, Stripe REST API

## Global Constraints

- Do not create a PaymentIntent, charge, refund or Stripe customer today.
- Do not print, copy, log or commit API keys, webhook secrets, client secrets, card data or personal data.
- Do not change product prices, GST, shipping, immutable order snapshots, provider amount calculation, completed orders or fulfilment status.
- Only verified Stripe webhooks or authoritative server reconciliation may mark an order paid.
- Stripe PaymentIntents use `payment_method_types: ["card"]`; automatic payment methods and Link are not enabled in this slice.
- Production publishable and server keys must both be live or both be test; mismatched or malformed groups fail closed.
- Production readiness requires live-mode keys, a root return origin of `https://rrgallery.co.nz`, and an enabled webhook endpoint at `https://rrgallery.co.nz/api/payments/webhooks/stripe`.
- The webhook endpoint must subscribe to `payment_intent.succeeded`, `payment_intent.processing`, `payment_intent.payment_failed`, `payment_intent.canceled` and `charge.refunded`; unrelated events make no payment mutation.
- Preserve the user's unrelated untracked files.
- Stop and notify the customer before the first step that can create a real charge.

Official references:

- Stripe API key modes and prefixes: <https://docs.stripe.com/keys>
- Explicit PaymentIntent payment methods: <https://docs.stripe.com/api/payment_intents/create>
- Authoritative payment status through webhooks: <https://docs.stripe.com/payments/payment-intents/verifying-status>

---

### Task 1: Fail closed on malformed or mixed Stripe key modes

**Files:**
- Modify: `src/server/payments/config.ts:47-61`
- Modify: `src/server/payments/config.test.ts:4-139`

**Interfaces:**
- Consumes: `parsePaymentConfig(env: Readonly<Record<string, string | undefined>>): PaymentConfig`
- Produces: the existing `StripePaymentConfig` union, enabled only for a matching publishable/server key mode and a `whsec_` webhook secret

- [ ] **Step 1: Correct the shared valid Stripe test fixture**

Replace the non-prefixed fake server key in `completeProviderEnvironment` so the existing valid-group test represents a real Stripe test-mode prefix:

```ts
const completeProviderEnvironment = {
  STRIPE_SECRET_KEY: "sk_test_not_real",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_not_real",
  STRIPE_WEBHOOK_SECRET: "whsec_not_real",
  // existing Afterpay and Zip fixture fields stay unchanged
} as const;
```

- [ ] **Step 2: Add failing configuration boundary tests**

Add these cases to `src/server/payments/config.test.ts`:

```ts
it.each([
  ["test secret with live publishable", "sk_test_not_real", "pk_live_not_real", "whsec_not_real"],
  ["live secret with test publishable", "sk_live_not_real", "pk_test_not_real", "whsec_not_real"],
  ["malformed server key", "stripe-secret", "pk_test_not_real", "whsec_not_real"],
  ["malformed publishable key", "sk_test_not_real", "stripe-public", "whsec_not_real"],
  ["malformed webhook secret", "sk_test_not_real", "pk_test_not_real", "stripe-webhook"],
] as const)("disables Stripe for %s", (_, secretKey, publishableKey, webhookSecret) => {
  const config = parsePaymentConfig({
    NODE_ENV: "production",
    PAYMENT_RETURN_BASE_URL: "https://rrgallery.co.nz",
    STRIPE_SECRET_KEY: secretKey,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: publishableKey,
    STRIPE_WEBHOOK_SECRET: webhookSecret,
  });

  expect(config.stripe).toEqual({ enabled: false });
});

it.each([
  ["standard test", "sk_test_not_real", "pk_test_not_real"],
  ["restricted test", "rk_test_not_real", "pk_test_not_real"],
  ["standard live", "sk_live_not_real", "pk_live_not_real"],
  ["restricted live", "rk_live_not_real", "pk_live_not_real"],
] as const)("enables a matching %s Stripe group", (_, secretKey, publishableKey) => {
  const config = parsePaymentConfig({
    NODE_ENV: "production",
    PAYMENT_RETURN_BASE_URL: "https://rrgallery.co.nz",
    STRIPE_SECRET_KEY: secretKey,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: publishableKey,
    STRIPE_WEBHOOK_SECRET: "whsec_not_real",
  });

  expect(config.stripe.enabled).toBe(true);
});
```

- [ ] **Step 3: Run the configuration tests and confirm RED**

Run:

```bash
npx vitest run src/server/payments/config.test.ts --exclude '.worktrees/**'
```

Expected: the mixed/malformed cases fail because the current parser only checks non-empty strings.

- [ ] **Step 4: Implement exact key-mode validation**

Add a small local helper and update `parseStripeConfig` in `src/server/payments/config.ts`:

```ts
type StripeMode = "test" | "live";

function stripeServerKeyMode(key: string): StripeMode | null {
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "test";
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
  return null;
}

function stripePublishableKeyMode(key: string): StripeMode | null {
  if (key.startsWith("pk_test_")) return "test";
  if (key.startsWith("pk_live_")) return "live";
  return null;
}
```

In `parseStripeConfig`, return `disabled()` unless:

```ts
const serverMode = secretKey ? stripeServerKeyMode(secretKey) : null;
const publishableMode = publishableKey
  ? stripePublishableKeyMode(publishableKey)
  : null;

if (
  !secretKey ||
  !publishableKey ||
  !webhookSecret?.startsWith("whsec_") ||
  !serverMode ||
  serverMode !== publishableMode
) return disabled();
```

Do not return the mode or any credential value in the public configuration DTO.

- [ ] **Step 5: Run focused checks and confirm GREEN**

Run:

```bash
npx vitest run src/server/payments/config.test.ts src/server/payments/provider-registry.test.ts --exclude '.worktrees/**'
npm run typecheck
git diff --check
```

Expected: all commands exit zero.

- [ ] **Step 6: Commit the configuration boundary**

```bash
git add src/server/payments/config.ts src/server/payments/config.test.ts
git commit -m "fix: validate Stripe key modes"
```

---

### Task 2: Restore the explicit Card-only PaymentIntent contract

**Files:**
- Modify: `src/server/payments/stripe-provider.ts:28-34,246-257`
- Modify: `src/server/payments/stripe-provider.test.ts:107-130`

**Interfaces:**
- Consumes: `PaymentProvider.createOrReuse(input: CreateProviderSessionInput)` and the persisted immutable `PaymentOrder`
- Produces: one Stripe PaymentIntent request with `payment_method_types: readonly ["card"]`

- [ ] **Step 1: Change the existing provider test to require Card-only**

Rename the test to `creates one card-only Stripe PaymentIntent without automatic methods` and change its expectation to:

```ts
expect(stripe.paymentIntents.create).toHaveBeenCalledWith({
  amount: order.amountCents,
  currency: "nzd",
  payment_method_types: ["card"],
  metadata: { order_number: order.orderNumber },
}, { idempotencyKey: sessionInput.idempotencyKey });

expect(vi.mocked(stripe.paymentIntents.create).mock.calls[0]?.[0])
  .not.toHaveProperty("automatic_payment_methods");
```

- [ ] **Step 2: Run the Stripe provider test and confirm RED**

Run:

```bash
npx vitest run src/server/payments/stripe-provider.test.ts --exclude '.worktrees/**'
```

Expected: the request contains `link` and fails the exact Card-only assertion.

- [ ] **Step 3: Make the minimal provider change**

Change `StripeCreateParams` and the request construction:

```ts
type StripeCreateParams = Readonly<{
  amount: number;
  currency: string;
  payment_method_types: readonly ["card"];
  metadata: Readonly<{ order_number: string }>;
}>;
```

```ts
payment_method_types: ["card"],
```

Do not add `automatic_payment_methods`, change amount/currency construction, or alter the returned client secret.

- [ ] **Step 4: Run Stripe, Elements and payment-service regression tests**

Run:

```bash
npx vitest run \
  src/server/payments/stripe-provider.test.ts \
  src/server/payments/payment-service.test.ts \
  src/components/stripe-payment-form.test.tsx \
  src/components/order-payment-panel.test.tsx \
  --exclude '.worktrees/**'
npm run typecheck
git diff --check
```

Expected: all commands exit zero; amount, currency, idempotency, recovery and Stripe Elements behavior remain unchanged.

- [ ] **Step 5: Commit the Card-only contract**

```bash
git add src/server/payments/stripe-provider.ts src/server/payments/stripe-provider.test.ts
git commit -m "fix: keep Stripe PaymentIntents card only"
```

---

### Task 3: Collect secret-safe production configuration evidence

**Files:**
- Create: `docs/audits/stripe-production-readiness-2026-08-15/report.md`
- Read only: Vercel production and preview environment metadata
- Temporary only: a mode-`600` directory under `/tmp`

**Interfaces:**
- Consumes: Vercel project `rrg-allery/rnr-gallery-staging` and its encrypted environment variables
- Produces: a report containing only booleans, key modes, origins, endpoint URLs, event names and HTTP statuses

- [ ] **Step 1: Inventory environment-variable scope without values**

Run:

```bash
npx vercel env ls production
npx vercel env ls preview
```

Record only whether these names exist and which Vercel environments they target:

```text
STRIPE_SECRET_KEY
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
STRIPE_WEBHOOK_SECRET
PAYMENT_RETURN_BASE_URL
PAYMENT_RECONCILIATION_SECRET
```

Do not paste the `value` column into the report.

- [ ] **Step 2: Pull production values into an isolated temporary directory**

Run:

```bash
stripe_audit_dir=$(mktemp -d /tmp/rnr-stripe-readiness.XXXXXX)
chmod 700 "$stripe_audit_dir"
umask 077
npx vercel env pull "$stripe_audit_dir/production.env" --environment=production --yes
```

Do not run `cat`, `env`, `set`, `printenv` or a command that echoes the file.

- [ ] **Step 3: Classify key modes and origin without printing credentials**

Load the file silently and print only classifications:

```bash
set -a
. "$stripe_audit_dir/production.env"
set +a
node -e '
const server = process.env.STRIPE_SECRET_KEY || "";
const publicKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";
const serverMode = /^(sk|rk)_live_/.test(server) ? "live" : /^(sk|rk)_test_/.test(server) ? "test" : "invalid";
const publicMode = /^pk_live_/.test(publicKey) ? "live" : /^pk_test_/.test(publicKey) ? "test" : "invalid";
let returnOrigin = "invalid";
try { returnOrigin = new URL(process.env.PAYMENT_RETURN_BASE_URL || "").origin; } catch {}
console.log(JSON.stringify({
  serverMode,
  publishableMode: publicMode,
  modesMatch: serverMode !== "invalid" && serverMode === publicMode,
  webhookSecretShape: /^whsec_/.test(process.env.STRIPE_WEBHOOK_SECRET || ""),
  returnOriginMatches: returnOrigin === "https://rrgallery.co.nz",
  reconciliationConfigured: Boolean((process.env.PAYMENT_RECONCILIATION_SECRET || "").trim()),
}));'
```

Expected production result before tomorrow's real charge:

```json
{"serverMode":"live","publishableMode":"live","modesMatch":true,"webhookSecretShape":true,"returnOriginMatches":true,"reconciliationConfigured":true}
```

If either mode is `test`, classify production as `NOT READY FOR REAL PAYMENT`; do not create a payment to test it.

- [ ] **Step 4: Check the Stripe account and webhook endpoints read-only**

Using the silently loaded server key, request only read operations and store raw responses inside the protected temporary directory:

```bash
curl -sS --fail-with-body \
  -u "${STRIPE_SECRET_KEY}:" \
  https://api.stripe.com/v1/account \
  -o "$stripe_audit_dir/account.json"

curl -sS --fail-with-body \
  -u "${STRIPE_SECRET_KEY}:" \
  'https://api.stripe.com/v1/webhook_endpoints?limit=100' \
  -o "$stripe_audit_dir/webhooks.json"
```

Print only safe fields:

```bash
jq '{country, default_currency, charges_enabled, payouts_enabled}' \
  "$stripe_audit_dir/account.json"

jq '[.data[] | select(.url == "https://rrgallery.co.nz/api/payments/webhooks/stripe") | {
  url,
  status,
  livemode,
  enabled_events
}]' "$stripe_audit_dir/webhooks.json"
```

Expected: one enabled live endpoint with every required event. If the API key returns a permission error for webhook listing, record `DASHBOARD CONFIRMATION REQUIRED`; do not broaden its permissions.

- [ ] **Step 5: Record preview-key exposure as a security finding**

If Vercel shows the production Stripe credential records targeting Preview as well as Production, record whether live keys are potentially available to preview deployments. Do not remove or rotate variables in this task. Mark live keys scoped to Preview as `REQUIRES CONFIGURATION CHANGE BEFORE PUBLIC PREVIEW USE`.

- [ ] **Step 6: Move temporary secret material to Trash after evidence extraction**

Use an explicit target:

```bash
trash_target="/Users/ronnieli/.Trash/rnr-stripe-readiness-$(date +%Y%m%d-%H%M%S)"
mv "$stripe_audit_dir" "$trash_target"
```

The report must not include the Trash path, hashes or credential fragments.

---

### Task 4: Verify production routes fail closed without mutations

**Files:**
- Update: `docs/audits/stripe-production-readiness-2026-08-15/report.md`
- Read only: `https://rrgallery.co.nz`

**Interfaces:**
- Consumes: deployed `/cart`, `/checkout`, Stripe webhook, Stripe return and reconciliation endpoints
- Produces: HTTP-status and bounded public-error evidence with zero order/payment mutations

- [ ] **Step 1: Verify public route health**

Run:

```bash
curl -sS -o /dev/null -w 'cart=%{http_code}\n' https://rrgallery.co.nz/cart
curl -sS -o /dev/null -w 'checkout=%{http_code}\n' https://rrgallery.co.nz/checkout
```

Expected: `cart=200` and `checkout=200` or an intentional authentication redirect documented by status and location.

- [ ] **Step 2: Verify missing and invalid Stripe signatures fail closed**

Run POST requests containing only `{}` and retain the bounded public bodies:

```bash
curl -sS -X POST \
  -H 'Content-Type: application/json' \
  --data '{}' \
  -o /tmp/rnr-stripe-webhook-missing.json \
  -w 'missing_signature=%{http_code}\n' \
  https://rrgallery.co.nz/api/payments/webhooks/stripe

curl -sS -X POST \
  -H 'Content-Type: application/json' \
  -H 'Stripe-Signature: t=1,v1=invalid' \
  --data '{}' \
  -o /tmp/rnr-stripe-webhook-invalid.json \
  -w 'invalid_signature=%{http_code}\n' \
  https://rrgallery.co.nz/api/payments/webhooks/stripe
```

Expected: both return `400` with `error.code = "INVALID_WEBHOOK"`. A `404` means Stripe is disabled; a `500` is a blocker.

- [ ] **Step 3: Verify malformed browser return cannot become payment authority**

Run:

```bash
curl -sS \
  -o /tmp/rnr-stripe-return-invalid.json \
  -w 'invalid_return=%{http_code}\n' \
  'https://rrgallery.co.nz/api/payments/returns/stripe'
```

Expected: `404` with `error.code = "PAYMENT_RETURN_NOT_FOUND"`; no redirect and no order mutation.

- [ ] **Step 4: Verify reconciliation is protected**

Run:

```bash
curl -sS -X POST \
  -o /tmp/rnr-stripe-reconcile-unauthorized.json \
  -w 'unauthorized_reconciliation=%{http_code}\n' \
  https://rrgallery.co.nz/api/internal/payments/reconcile
```

Expected: `401` with `error.code = "UNAUTHORIZED"`. Do not invoke reconciliation with the real bearer secret during this readiness probe.

- [ ] **Step 5: Record results and remove only non-secret response files**

Copy only HTTP statuses and public error codes into the report. Move the three `/tmp/rnr-stripe-*.json` response files to a new explicit Trash folder; do not use a recursive delete command.

---

### Task 5: Run complete automated and production-build verification

**Files:**
- Update: `docs/audits/stripe-production-readiness-2026-08-15/report.md`
- Test only: existing payment, checkout, database and UI suites

**Interfaces:**
- Consumes: Tasks 1-4 and the existing disposable PostgreSQL container `rnr-next-payment-test`
- Produces: exact pass/fail counts and a production build result

- [ ] **Step 1: Run the focused Stripe/payment suite**

Run:

```bash
npx vitest run \
  src/server/payments/config.test.ts \
  src/server/payments/stripe-provider.test.ts \
  src/server/payments/payment-service.test.ts \
  'src/app/api/payments/webhooks/[provider]/route.test.ts' \
  'src/app/api/payments/returns/[provider]/route.test.ts' \
  src/app/api/internal/payments/reconcile/route.test.ts \
  src/components/stripe-payment-form.test.tsx \
  src/components/order-payment-panel.test.tsx \
  src/components/checkout-view.test.tsx \
  --exclude '.worktrees/**'
```

Expected: all focused files and tests pass.

- [ ] **Step 2: Create fresh isolated databases and migrate the integration database**

Use unique explicit names, for example:

```bash
docker exec rnr-next-payment-test createdb -U rnr_test rnr_ci_app_stripe_0815
docker exec rnr-next-payment-test createdb -U rnr_test rnr_integration_stripe_0815
DATABASE_URL='postgresql://rnr_test:rnr_test@127.0.0.1:55443/rnr_integration_stripe_0815' npm run db:migrate
```

- [ ] **Step 3: Run the full suite against isolated databases**

Run:

```bash
DATABASE_URL='postgresql://rnr_test:rnr_test@127.0.0.1:55443/rnr_ci_app_stripe_0815' \
TEST_DATABASE_URL='postgresql://rnr_test:rnr_test@127.0.0.1:55443/rnr_integration_stripe_0815' \
npm run test:run -- --exclude '.worktrees/**'
```

Expected: every test passes. Any failure is `FAILED`, must be fixed from its concrete evidence, and the full suite rerun.

- [ ] **Step 4: Run static and schema checks**

Run:

```bash
npm run typecheck
npm run lint
npm run db:check
git diff --check
```

Expected: all commands exit zero.

- [ ] **Step 5: Run a production build with validation-only credentials**

Run:

```bash
DATABASE_URL='postgresql://rnr_test:rnr_test@127.0.0.1:55443/rnr_ci_app_stripe_0815' \
BETTER_AUTH_URL='https://example.test' \
BETTER_AUTH_SECRET='test-only-secret-not-for-production' \
PAYMENT_RETURN_BASE_URL='https://example.test' \
STRIPE_SECRET_KEY='sk_test_not_real' \
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY='pk_test_not_real' \
STRIPE_WEBHOOK_SECRET='whsec_not_real' \
ENABLE_LOCAL_TEST_PAYMENTS='false' \
npm run build
```

Expected: Next.js production build exits zero without external Stripe calls.

- [ ] **Step 6: Drop only the disposable databases**

```bash
docker exec rnr-next-payment-test dropdb -U rnr_test rnr_ci_app_stripe_0815
docker exec rnr-next-payment-test dropdb -U rnr_test rnr_integration_stripe_0815
```

---

### Task 6: Finalize evidence and deploy the exact verified commit

**Files:**
- Update: `docs/audits/stripe-production-readiness-2026-08-15/report.md`
- Deploy: exact tracked files from the final Git commit

**Interfaces:**
- Consumes: verified code commits, production evidence and test/build results
- Produces: a clean Vercel production deployment on `rrgallery.co.nz`

- [ ] **Step 1: Complete the report without secrets or personal data**

The report must contain:

```markdown
# Stripe Production Readiness — 2026-08-15

## Outcome
- READY FOR CUSTOMER REAL-PAYMENT TEST or BLOCKED

## Configuration
- Server key mode: live/test/invalid
- Publishable key mode: live/test/invalid
- Modes match: PASS/FAIL
- Return origin: PASS/FAIL
- Webhook endpoint and required events: PASS/FAIL/DASHBOARD CONFIRMATION REQUIRED
- Preview live-key scope: PASS/REQUIRES CONFIGURATION CHANGE

## Fail-closed production probes
- Cart/checkout health
- Missing webhook signature
- Invalid webhook signature
- Invalid browser return
- Unauthorized reconciliation

## Automated verification
- Focused tests
- Full test files/tests
- Typecheck
- Lint
- DB check
- Production build

## Remaining manual acceptance
- One customer-operated real card payment tomorrow
```

- [ ] **Step 2: Commit the evidence report**

```bash
git add docs/audits/stripe-production-readiness-2026-08-15/report.md
git commit -m "docs: record Stripe production readiness"
```

- [ ] **Step 3: Verify the tracked worktree and enumerate excluded files**

Run:

```bash
git diff --quiet HEAD --
git status --short
git rev-parse HEAD
```

Expected: tracked files are clean. Existing unrelated untracked files remain listed and untouched.

- [ ] **Step 4: Create and compare a clean release archive**

Run:

```bash
release_dir=$(mktemp -d /tmp/rnr-stripe-release.XXXXXX)
git archive HEAD | tar -xf - -C "$release_dir"
git ls-tree -r --name-only HEAD | LC_ALL=C sort > "$release_dir.expected-files"
(cd "$release_dir" && rg --files -uu | LC_ALL=C sort) > "$release_dir.actual-files"
diff -u "$release_dir.expected-files" "$release_dir.actual-files"
mkdir -p "$release_dir/.vercel"
cp .vercel/project.json "$release_dir/.vercel/project.json"
```

Expected: the archive and Git file lists match exactly before `.vercel/project.json` is copied.

- [ ] **Step 5: Deploy the clean archive**

Use the actual final commit SHA in metadata:

```bash
npx vercel deploy "$release_dir" --prod --yes --force \
  -m "gitCommitSha=$(git rev-parse HEAD)" \
  -m 'gitCommitRef=feat/payment-adapters' \
  -m 'gitCommitMessage=fix: harden Stripe production readiness'
```

Expected: Vercel reports `READY` and aliases `https://rrgallery.co.nz`.

- [ ] **Step 6: Verify deployment metadata, source mapping and route health**

Confirm through the Vercel deployment APIs and public routes:

- deployed SHA equals `git rev-parse HEAD`;
- `gitDirty` is absent/null;
- deployed source files equal the commit except Vercel's automatic `.gitignore` exclusion;
- unrelated untracked files are absent;
- `/cart` and `/checkout` are healthy;
- invalid Stripe webhook signatures still return `400`.

- [ ] **Step 7: Move the clean release directory and comparison files to Trash**

Use explicit paths and `mv`; do not recursively delete them.

---

### Task 7: Stop at the customer-operated real-payment gate

**Files:**
- Update after acceptance: `docs/audits/stripe-production-readiness-2026-08-15/report.md`
- No code change before the customer payment

**Interfaces:**
- Consumes: the deployed production Stripe flow and one customer-operated card payment
- Produces: final acceptance evidence for PaymentIntent, webhook, order state, idempotency and identity-scoped cleanup

- [ ] **Step 1: Tell the customer the system is ready for their real payment**

Do not proceed until Tasks 1-6 are all PASS or all external configuration blockers are explicitly resolved.

- [ ] **Step 2: Have the customer perform the payment**

The customer uses the existing production checkout and existing authoritative price. The assistant does not type, capture or inspect card details.

- [ ] **Step 3: Verify the resulting flow without exposing personal data**

Confirm:

```text
one order
one nonterminal-to-paid payment attempt
one accepted payment_intent.succeeded webhook event
exact immutable order amount and NZD currency
Order confirmed. UI
no duplicate order or charge after refresh/reopen
paying identity Cart/recovery cleared; other identities unchanged
```

- [ ] **Step 4: Mark Stripe accepted or FAILED**

If every item passes, update the report to `STRIPE REAL PAYMENT ACCEPTED`. If any item fails, mark it `FAILED`, preserve the unpaid/ambiguous state, and fix only from concrete evidence before another real-payment attempt.

After Stripe acceptance, start a separate Afterpay production-readiness design. Do not fold Afterpay credentials or behavior into this Stripe plan.
