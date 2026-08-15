# Stripe Card Wallets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Stripe checkout clearly support Card, Apple Pay, and Google Pay on eligible devices while keeping Afterpay separate and preserving all payment authority and recovery safeguards.

**Architecture:** Keep the existing card-only Stripe PaymentIntent and Payment Element. Apple Pay and Google Pay remain card wallets selected by Stripe through the existing `wallets: { applePay: "auto", googlePay: "auto" }` configuration; the implementation adds truthful customer-facing wallet copy and registers the production domains in Stripe. No automatic payment methods or Express Checkout Element are introduced.

**Tech Stack:** Next.js 16, React 19, TypeScript, Stripe PaymentIntents, Stripe React Payment Element, Vitest, Testing Library, Vercel, Stripe Dashboard

## Global Constraints

- Stripe supports only Card, Apple Pay, and Google Pay in this scope.
- Afterpay remains an independently selected second payment option.
- Keep `payment_method_types: ["card"]`; do not enable Stripe automatic payment methods.
- Preserve exact order amount, NZD currency, order metadata, idempotency, provider-reference verification, webhooks, reconciliation, and customer-identity isolation.
- Existing bound PaymentIntents must be retrieved during recovery and never recreated.
- Wallet visibility must remain automatic and truthful: unsupported browsers, devices, domains, or wallets must not be promised a wallet button.
- Do not add Link, PayPal, Klarna, Stripe-hosted Afterpay, bank debits, Express Checkout Element, dependencies, or real-money test charges.
- Modify only wallet disclosure, its tests, Stripe payment-method domain configuration, verification evidence, and deployment state.

---

### Task 1: Add truthful wallet disclosure to the existing Stripe option

**Files:**
- Modify: `src/components/payment-methods.tsx:77-87`
- Test: `src/components/payment-methods.test.tsx:25-47`

**Interfaces:**
- Consumes: `PaymentMethods({ methods, value, onChange, disabled })`
- Produces: the exact visible copy `Card, Apple Pay and Google Pay are supported. Wallets appear only on eligible devices.` only while the `card` method is selected

- [ ] **Step 1: Write the failing disclosure test**

Extend the existing `renders an accessible payment radiogroup and truthful test copy` test with:

```tsx
expect(screen.getByText(
  "Card, Apple Pay and Google Pay are supported. Wallets appear only on eligible devices.",
)).toBeInTheDocument();
```

Extend `only shows Stripe card trust information when Card is selected` with:

```tsx
expect(screen.queryByText(
  "Card, Apple Pay and Google Pay are supported. Wallets appear only on eligible devices.",
)).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- --run src/components/payment-methods.test.tsx
```

Expected: FAIL because the wallet disclosure is not rendered.

- [ ] **Step 3: Add the minimal disclosure**

In the existing `value === "card"` branch, keep the lock icon and Stripe trust line unchanged, then add:

```tsx
<p className={styles.checkoutMessage}>
  Card, Apple Pay and Google Pay are supported. Wallets appear only on eligible devices.
</p>
```

Do not add wallet logos or separate wallet radio inputs because availability is determined only after Stripe renders the Payment Element.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm test -- --run src/components/payment-methods.test.tsx
```

Expected: 1 test file passes with 0 failures.

- [ ] **Step 5: Commit the UI disclosure**

```bash
git add src/components/payment-methods.tsx src/components/payment-methods.test.tsx
git commit -m "feat: disclose Stripe wallet support"
```

---

### Task 2: Register the stable Stripe payment-method domains

**Files:**
- No repository files change.
- External configuration: Stripe Dashboard payment method domains for the account used by the deployed Stripe publishable key.

**Interfaces:**
- Consumes: the existing Stripe account, deployed publishable-key mode, and these exact domains: `rrgallery.co.nz`, `www.rrgallery.co.nz`, `rnr-gallery-staging.vercel.app`, `rnr-gallery-staging-rrg-allery.vercel.app`
- Produces: active Stripe payment-method domain registrations that permit eligible Apple Pay and Google Pay controls to render

- [ ] **Step 1: Verify the Stripe account and current key mode without exposing secrets**

Use the already authenticated Stripe Dashboard and the deployed page bundle/config evidence to confirm the Dashboard account matches the current Stripe requests and whether the deployed publishable key is test or live. Record only `test` or `live`; never print the key.

Expected: the current site remains in test mode until the separately planned real-payment switch.

- [ ] **Step 2: Inventory existing payment-method domains**

Open Stripe Dashboard → Settings → Payment methods → Payment method domains in live mode. Check each exact domain before adding it. Do not create duplicates.

Expected: a four-row checklist with each domain marked existing-active, existing-disabled, or missing.

- [ ] **Step 3: Register or enable the four stable domains**

For each missing domain, choose **Add a new domain**, enter only the hostname, and save. For each disabled matching domain, enable it. Do not register changing per-deployment URLs.

Expected: all four exact stable domains are active in live mode. Stripe's live registration also makes the domains available to sandboxes according to Stripe's domain-registration behavior.

- [ ] **Step 4: Verify the currently deployed key mode can see the domains**

Switch to the Stripe test/sandbox view used by the deployed key and reopen Payment method domains.

Expected: all four domains are present and active for the environment serving the current test checkout. If any is absent, add only that exact missing domain in the test/sandbox view.

- [ ] **Step 5: Preserve the browser state for wallet verification**

Leave the Stripe Dashboard on the payment-method domains page and do not alter API keys, webhook endpoints, payment-method toggles, balances, customers, or PaymentIntents.

---

### Task 3: Lock the wallet boundary and run payment regression gates

**Files:**
- Verify without modification: `src/components/stripe-payment-form.tsx:77-79`
- Verify without modification: `src/components/stripe-payment-form.test.tsx:57-71`
- Verify without modification: `src/server/payments/stripe-provider.ts:257-275`
- Verify without modification: `src/server/payments/stripe-provider.test.ts:107-161`
- Verify without modification: `src/server/payments/payment-service.test.ts:615-660`
- Verify without modification: `src/server/payments/drizzle-payment-repository.integration.test.ts:413-486`

**Interfaces:**
- Consumes: `PaymentElement` wallet options, card-only PaymentIntent creation, and bound-intent recovery
- Produces: fresh evidence that wallet enablement does not broaden server payment methods or regress recovery

- [ ] **Step 1: Run the focused wallet and Stripe tests**

```bash
npm test -- --run \
  src/components/payment-methods.test.tsx \
  src/components/stripe-payment-form.test.tsx \
  src/server/payments/stripe-provider.test.ts \
  src/server/payments/payment-service.test.ts
```

Expected: all focused tests pass, including these behaviors:

```text
PaymentElement wallets = { applePay: "auto", googlePay: "auto" }
PaymentIntent payment_method_types = ["card"]
automatic_payment_methods is absent
bound PaymentIntent recovery uses retrieve and never create
```

- [ ] **Step 2: Run the database payment integration test**

```bash
set -a
source .env.local
set +a
npm test -- --run src/server/payments/drizzle-payment-repository.integration.test.ts
```

Expected: 24 tests pass with 0 failures, including Stripe Elements recovery.

- [ ] **Step 3: Run the complete test suite against the configured dedicated test database**

```bash
set -a
source .env.local
set +a
npm test -- --run --reporter=dot
```

Expected: every test file and test passes with 0 failures. Skips are permitted only when already declared by the suite.

- [ ] **Step 4: Run static and schema gates**

```bash
npm run lint
npm run typecheck
npm run db:check
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Run a production build with validation-only credentials**

```bash
set -a
source .env.local
set +a
BETTER_AUTH_URL='https://example.test' \
BETTER_AUTH_SECRET='build-only-a9K7mQ2xV8pL4sN6dR3tY5uW1cE0zH' \
PAYMENT_RETURN_BASE_URL='https://example.test' \
STRIPE_SECRET_KEY='sk_test_not_real' \
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY='pk_test_not_real' \
STRIPE_WEBHOOK_SECRET='whsec_not_real' \
ENABLE_LOCAL_TEST_PAYMENTS='false' \
npm run build
```

Expected: Next.js production build exits 0 without calling Stripe or processing a payment.

---

### Task 4: Deploy the exact verified commit and validate wallets safely

**Files:**
- Deployment source: a temporary clean `git archive` of the verified commit
- No additional repository files change.

**Interfaces:**
- Consumes: the verified commit from Tasks 1-3 and Vercel project `rnr-gallery-staging`
- Produces: a READY production deployment aliased to `rrgallery.co.nz` with exact source provenance

- [ ] **Step 1: Confirm deployment scope**

```bash
git status --short
git diff --check
git show --stat --oneline HEAD
```

Expected: no tracked changes remain, and unrelated untracked audit files are not included in the wallet commit.

- [ ] **Step 2: Create and compare a clean deployment archive**

```bash
deploy_dir=$(mktemp -d /tmp/rnr-wallets.XXXXXX)
git archive --format=tar HEAD | tar -xf - -C "$deploy_dir"
mkdir -p "$deploy_dir/.vercel"
cp .vercel/project.json "$deploy_dir/.vercel/project.json"
git ls-tree -r --name-only HEAD | wc -l
find "$deploy_dir" -type f ! -path "$deploy_dir/.vercel/project.json" | wc -l
```

Expected: the two file counts are equal before Vercel applies its normal `.gitignore` exclusion.

- [ ] **Step 3: Deploy production from that archive**

```bash
npx --no-install vercel deploy --prod --yes --cwd "$deploy_dir"
```

Expected: Vercel returns `readyState: READY`, `target: production`, and aliases `https://rrgallery.co.nz` to the new deployment.

- [ ] **Step 4: Verify production health and safety boundaries**

Use Node `fetch` to request `/`, `/cart`, and `/checkout`; each must return 200. POST `{}` without a Stripe signature to `/api/payments/webhooks/stripe`; it must return 400 with `INVALID_WEBHOOK`.

Expected: storefront routes are healthy and webhook verification remains fail-closed.

- [ ] **Step 5: Verify wallet presentation without a real charge**

On `https://rrgallery.co.nz`, start a fresh test-mode Stripe payment on:

```text
Apple Pay: Safari on a supported Apple device with an active Wallet card
Google Pay: Chrome on a supported device/profile with an active Google Pay card
```

Expected: the eligible wallet appears inside Stripe's Payment Element. Stop before final wallet authorization; do not complete a real-money payment.

- [ ] **Step 6: Check Stripe logs and preserve order integrity**

Verify the wallet test produced no Stripe API error and did not create duplicate PaymentIntents for a resumed order. Query only non-PII fields in the payment attempt record: status, provider-reference presence, return-state presence, and attempt count.

Expected: one owned payment attempt per order, unchanged amount/currency, and no idempotency error.

- [ ] **Step 7: Push the verified commit**

```bash
git push origin HEAD:refs/heads/feat/payment-adapters
```

Expected: remote `feat/payment-adapters` resolves to the same SHA as local `HEAD`.

