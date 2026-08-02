# Payment Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fail-closed provider-neutral payment layer for Stripe card, Afterpay and Zip without changing the existing authoritative order, shipping or ownership rules.

**Architecture:** The current checkout first persists one immutable `awaiting_payment` order. A payment service then persists/reuses one attempt and invokes an enabled adapter with the order amount, currency and identity from PostgreSQL; React sees only public method/action DTOs. A browser return can never mark an order paid: only server capture, a signature-verified webhook, or reconciliation may do so.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, PostgreSQL, Drizzle ORM, Zod 4, Vitest, Testing Library, official Stripe libraries, native fetch for Afterpay v2 and Zip.

## Global Constraints

- Work only in this independent Next.js repository. Never modify or query WordPress/WooCommerce.
- Persisted order amount/currency are the only payment authority; never accept client totals.
- Do not add implicit currency conversion. Current orders remain NZD.
- Missing/partial credentials fail closed and cause zero external calls.
- Local-test adapters require `ENABLE_LOCAL_TEST_PAYMENTS=true` and throw in production.
- Automated and browser tests use injected mocks/local adapters only; no real provider call is executed.
- Browser return/query state is untrusted and cannot mark paid.
- Only server capture, verified webhook, or reconciliation may mark paid.
- Stripe PaymentIntents use `payment_method_types: ["card"]`; do not enable automatic payment methods.
- Do not store/log card data, secrets, client secrets, raw webhook payloads or PII.
- Zip v2 charge supports only AUD, USD and CAD. Effective eligibility is the intersection of that immutable provider allowlist and the merchant-configured allowlist. Current NZD orders therefore never offer real Zip and make zero Zip calls.
- At most one nonterminal attempt exists per order/provider/method. Provider idempotency is stable and derived server-side from that persisted attempt; a browser UUID is only a retry hint.
- A provider return state is consumed atomically exactly once. Duplicate returns make no provider call and show the stored state while reconciliation owns any later retrieval.
- A verified webhook event claim, locked attempt/order validation, transition and processed result commit atomically; injected faults must remain replayable.
- On 2 August 2026 Zip NZ is closed to new merchant/customer applications and ceases NZ transactions at 11:59 pm on 16 August 2026; no NZ grace-period path is implemented.
- Commit generated Drizzle SQL/meta. Production startup never auto-migrates.

## Official References

- Stripe PaymentIntents: <https://docs.stripe.com/payments/payment-intents>
- Stripe raw-body webhook verification: <https://docs.stripe.com/webhooks/signature>
- Afterpay v2 quickstart/capture: <https://developers.afterpay.com/afterpay-online-developer/guides/api-development/api-quickstart>
- Zip checkout: <https://developers.zip.co/v2/docs/create-a-checkout>
- Zip charge: <https://developers.zip.co/v2/docs/create-a-charge>
- Zip NZ closure: <https://help-nz.zip.co/hc/en-us/articles/16870355462927-Zip-NZ-Business-Closure-Merchant-Information>

---

## Planned Commit Sequence

1. Payment schema and migration
2. Provider-neutral contract/state machine
3. Configuration and country eligibility
4. Atomic payment repository
5. Local-test providers/registry
6. Payment service and API integration
7. Checkout/order payment UI
8. Stripe adapter and Elements
9. Afterpay v2 adapter
10. Zip AU adapter
11. Stripe webhook transaction
12. One-time redirect returns
13. Payment reconciliation
14. Public payment-state projection
15. Browser acceptance and evidence

---

### Task 1: Payment schema and migration

**Files:**
- Create: `src/server/db/schema/payments.ts`
- Modify: `src/server/db/schema/orders.ts`
- Modify: `src/server/db/schema/index.ts`
- Create: `src/server/db/schema/payment-schema.test.ts`
- Create: `src/server/db/schema/payment-schema.integration.test.ts`
- Generate: `drizzle/0004_*.sql`, `drizzle/meta/0004_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

**Interfaces:**
- Consumes: immutable `orders(id, totalInclGstCents, currency)`.
- Produces: `paymentAttempts`, `webhookEvents`, payment provider/method/status types.

- [ ] **Step 1: Write failing schema and PostgreSQL constraint tests**

```ts
expect(getTableName(paymentAttempts)).toBe("payment_attempts");
expect(getTableName(webhookEvents)).toBe("webhook_events");
await insertAttempt({ orderId, provider: "stripe", idempotencyKey: key });
await expect(insertAttempt({ orderId, provider: "stripe", idempotencyKey: key }))
  .rejects.toThrow("payment_attempts_provider_idempotency_unique");
await expect(insertAttempt({ orderId, expectedAmountCents: 1 }))
  .rejects.toThrow("payment_attempts_expected_order_amount_fk");
await expect(Promise.all([
  insertNonterminalAttempt({ orderId, provider: "stripe", method: "card" }),
  insertNonterminalAttempt({ orderId, provider: "stripe", method: "card" }),
])).rejects.toThrow("payment_attempts_one_nonterminal_unique");
```

- [ ] **Step 2: Run the tests and confirm they fail because the schema is absent**

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm test -- --run \
  src/server/db/schema/payment-schema.test.ts \
  src/server/db/schema/payment-schema.integration.test.ts
```

- [ ] **Step 3: Implement the minimal tables and constraints**

```ts
export type PaymentProviderKey = "stripe" | "afterpay" | "zip" | "local-test";
export type PaymentMethodKey = "card" | "afterpay" | "zip";
export type PaymentAttemptStatus =
  | "created" | "requires_action" | "processing"
  | "paid" | "failed" | "cancelled";
```

`payment_attempts` contains order ID, provider, method, server-derived idempotency key, optional provider reference, provider-session lease ID/expiry, one-time return-state digest and consumed timestamp, expected amount/currency, country, status, sanitized failure code and timestamps. `webhook_events` contains provider, provider event ID, SHA-256, optional attempt ID, processing result and timestamps. It does not contain raw payloads.

Add:

- unique `(provider, idempotency_key)`;
- PostgreSQL partial unique `(order_id, provider, method)` where status is one of `created`, `requires_action` or `processing`;
- unique nullable `(provider, provider_reference)`;
- positive expected amount check;
- composite order-money FK from attempt `(order_id, expected_amount_cents, currency)` to a new unique order key `(id, total_incl_gst_cents, currency)`;
- unique `(provider, provider_event_id)`;
- SHA-256 format check.

The generated SQL must include the partial unique index explicitly. A failed/cancelled attempt may be followed by a new attempt; a paid order may not.

- [ ] **Step 4: Generate, inspect and apply the migration**

```bash
DATABASE_URL="$TEST_DATABASE_URL" npm run db:generate
rg -n "payment_attempts|webhook_events|expected_order_amount" drizzle/0004_*.sql
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
```

- [ ] **Step 5: Pass tests and DB check**

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm test -- --run \
  src/server/db/schema/payment-schema.test.ts \
  src/server/db/schema/payment-schema.integration.test.ts
npm run db:check
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/server/db/schema drizzle
git commit -m "feat: add payment persistence schema"
```

---

### Task 2: Provider-neutral contract and monotonic state machine

**Files:**
- Create: `src/server/payments/types.ts`
- Create: `src/server/payments/state-machine.ts`
- Create: `src/server/payments/state-machine.test.ts`
- Create: `src/server/payments/public-dto.ts`

**Interfaces:**
- Consumes: Task 1 payment keys and existing `OrderPaymentStatus`.
- Produces: `PaymentProvider`, `PaymentOrder`, `ProviderSession`, `VerifiedPaymentResult`, `VerifiedProviderEvent`, `PaymentActionDTO`.

- [ ] **Step 1: Write the failing transition matrix**

```ts
it.each([
  ["awaiting_payment", "processing", "processing"],
  ["processing", "paid", "paid"],
  ["paid", "failed", "paid"],
  ["failed", "processing", "processing"],
])("%s + %s => %s", (current, incoming, expected) => {
  expect(nextOrderPaymentStatus(current, incoming)).toBe(expected);
});
expect(verifiedIncomingStatus("browser_return", "paid")).toBe("processing");
expect(verifiedIncomingStatus("server_capture", "paid")).toBe("paid");
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- --run src/server/payments/state-machine.test.ts
```

- [ ] **Step 3: Define the exact provider contract**

```ts
export type PaymentOrder = Readonly<{
  id: string;
  orderNumber: string;
  amountCents: number;
  currency: "NZD" | "AUD" | "USD" | "CAD";
  country: "NZ" | "AU";
  customer: Readonly<{ fullName: string; email: string; phone: string }>;
  billingAddress: NormalizedAddress;
  deliveryAddress: NormalizedAddress;
}>;

export interface PaymentProvider {
  readonly key: PaymentProviderKey;
  readonly method: PaymentMethodKey;
  readonly refundCapability: "unsupported" | "full" | "partial";
  availability(order: PaymentOrder): Promise<ProviderAvailability>;
  createOrReuse(input: CreateProviderSessionInput): Promise<ProviderSession>;
  completeReturn(input: CompleteProviderReturnInput): Promise<VerifiedPaymentResult>;
  retrieve(input: RetrieveProviderPaymentInput): Promise<VerifiedPaymentResult>;
  verifyWebhook?(rawBody: Uint8Array, headers: Headers): Promise<VerifiedProviderEvent>;
}
```

`ProviderSession` is a discriminated union: `elements` with transient Stripe client secret, `redirect` with redirect URL, or `test` with a local URL. `VerifiedPaymentResult` always includes provider reference/status, amount, currency, order number and normalized status.

The provider contract is currency-capable for isolated adapter tests, but the current order repository and service still produce only persisted NZD orders. `refundCapability` is declarative in this scope; every initial adapter reports `"unsupported"` until a refund operation is actually implemented. This prevents callers from assuming support, and no refund mutation/API/UI is added by this plan.

- [ ] **Step 4: Implement serializers and transition guards**

`paid` is accepted only from `server_capture`, `verified_webhook` or `reconciliation`. A paid order ignores later processing/failure/cancelled input. Public DTOs never include attempt ID, provider reference, return state, client secret after the immediate owning response, or provider errors.

- [ ] **Step 5: Pass checks and commit**

```bash
npm test -- --run src/server/payments/state-machine.test.ts
npm run lint
npm run typecheck
git add src/server/payments
git commit -m "feat: define payment provider contract"
```

---

### Task 3: Strict configuration and country eligibility

**Files:**
- Create: `src/server/payments/config.ts`
- Create: `src/server/payments/config.test.ts`
- Create: `src/server/payments/eligibility.ts`
- Create: `src/server/payments/eligibility.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `PaymentOrder`.
- Produces: `parsePaymentConfig(env)`, `paymentEligibility(order, config, limits)`.

- [ ] **Step 1: Write fail-closed tests**

```ts
expect(parsePaymentConfig({})).toMatchObject({
  stripe: { enabled: false },
  afterpay: { enabled: false },
  zip: { enabled: false },
  localTest: { enabled: false },
});
expect(() => parsePaymentConfig({
  NODE_ENV: "production",
  ENABLE_LOCAL_TEST_PAYMENTS: "true",
})).toThrow("Local test payments cannot run in production");
expect(zipEligibility(nzOrder, auZipConfig))
  .toEqual({ available: false, reason: "country" });
expect(zipEligibility(auOrderInNzd, auZipConfig)).toEqual({
  available: false,
  reason: "currency",
});
```

Also assert AU Zip is unavailable unless `ZIP_MERCHANT_COUNTRY=AU`, credentials are complete and the persisted order currency belongs to both the immutable Zip v2 charge allowlist (`AUD`, `USD`, `CAD`) and `ZIP_ALLOWED_CURRENCIES`. Current NZD orders are not converted, never offer real Zip and make zero Zip calls even if the merchant list incorrectly contains NZD.

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- --run \
  src/server/payments/config.test.ts \
  src/server/payments/eligibility.test.ts
```

- [ ] **Step 3: Implement strict all-or-nothing groups**

```dotenv
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
AFTERPAY_MERCHANT_ID=
AFTERPAY_SECRET_KEY=
AFTERPAY_ENVIRONMENT=
AFTERPAY_MERCHANT_COUNTRY=
ZIP_API_KEY=
ZIP_ENVIRONMENT=
ZIP_MERCHANT_COUNTRY=
ZIP_ALLOWED_CURRENCIES=
PAYMENT_RETURN_BASE_URL=
PAYMENT_RECONCILIATION_SECRET=
ENABLE_LOCAL_TEST_PAYMENTS=false
```

An incomplete group returns `enabled: false`; do not throw during ordinary page render and do not expose missing variable names or values to the browser. Production local-test enablement is the one configuration error that throws.

- [ ] **Step 4: Add exact eligibility rules**

- Stripe: configured, order currency explicitly supported.
- Afterpay: configured merchant country/currency and total inside server-fetched min/max limits.
- Zip: delivery country AU, merchant country AU, complete credentials, and persisted currency in the intersection of `new Set(["AUD", "USD", "CAD"])` and the merchant-configured allowlist. NZ is always false; with the current fixed NZD order model, real Zip is always false.
- Local test: explicit flag, non-production, and mirrors NZ/AU method rules while visibly marked test.

- [ ] **Step 5: Pass checks and commit**

```bash
npm test -- --run \
  src/server/payments/config.test.ts \
  src/server/payments/eligibility.test.ts
npm run lint
npm run typecheck
git add .env.example src/server/payments
git commit -m "feat: gate payment provider eligibility"
```

---

### Task 4: Atomic payment repository

**Files:**
- Create: `src/server/payments/payment-repository.ts`
- Create: `src/server/payments/drizzle-payment-repository.ts`
- Create: `src/server/payments/drizzle-payment-repository.test.ts`
- Create: `src/server/payments/drizzle-payment-repository.integration.test.ts`

**Interfaces:**
- Consumes: Tasks 1-2 and existing guest/customer order ownership.
- Produces: `PaymentRepository`.

- [ ] **Step 1: Write repository contract and concurrency tests**

```ts
export interface PaymentRepository {
  findPayableOrder(access: PaymentOrderAccess): Promise<PaymentOrder | null>;
  createOrClaimNonterminalAttempt(input: CreatePaymentAttemptInput): Promise<AttemptClaim>;
  bindProviderSession(input: BindProviderSessionInput & { claimId: string }): Promise<PaymentAttemptRecord>;
  consumeReturnState(provider: PaymentProviderKey, digest: string): Promise<ConsumedReturnState | null>;
  applyVerifiedWebhookEventAtomically(input: VerifiedEventInput): Promise<"applied" | "duplicate" | "hash_mismatch">;
  applyVerifiedResult(input: ApplyVerifiedResultInput): Promise<PaymentAttemptWithOrder>;
  listReconciliationCandidates(limit: number): Promise<readonly PaymentAttemptWithOrder[]>;
}
```

Test simultaneous starts with two different browser UUIDs create/reuse one nonterminal row and return only one provider-session claim. Test the same event/hash applies once, the same event/different hash is rejected, duplicate return-state consumption returns null, wrong guest token/customer returns null, and amount/currency/reference mismatch changes no state.

```ts
const [first, second] = await Promise.all([
  repository.createOrClaimNonterminalAttempt({ ...input, clientKey: crypto.randomUUID() }),
  repository.createOrClaimNonterminalAttempt({ ...input, clientKey: crypto.randomUUID() }),
]);
expect(new Set([first.attempt.id, second.attempt.id])).toHaveSize(1);
expect([first.claimId, second.claimId].filter(Boolean)).toHaveLength(1);
```

- [ ] **Step 2: Run and confirm failure**

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm test -- --run \
  src/server/payments/drizzle-payment-repository.test.ts \
  src/server/payments/drizzle-payment-repository.integration.test.ts
```

- [ ] **Step 3: Implement row locking, attempt claims and stable idempotency**

Inside a transaction, lock the order and selected attempt with `FOR UPDATE`, validate immutable order fields and reuse the one nonterminal attempt for that order/provider/method. The transaction grants one short provider-session lease (`claimId`, expiry) to the caller allowed to create externally; concurrent callers receive the same attempt without a claim and must not call the provider. A crashed/expired lease may be reclaimed, but every claimant uses the same server-derived upstream idempotency key, for example SHA-256 of a versioned tuple containing attempt ID, provider and operation. Never derive the upstream key from the browser UUID.

`bindProviderSession` succeeds only for the active claim. `consumeReturnState` locks the attempt and changes `return_state_consumed_at` from null exactly once. `applyVerifiedResult` locks order/attempt, calls `nextOrderPaymentStatus`, and updates both together. Store only sanitized failure codes.

- [ ] **Step 4: Add transactional webhook fault-injection tests**

Inject failures after event insert, after locked validation/transition and before processed-result write. Every failure must roll back the full transaction so a replay can apply once. A committed duplicate returns its existing processed result without reapplying; a deliberately supported duplicate-unprocessed row must be claimable and recoverable rather than permanently skipped.

- [ ] **Step 5: Pass DB/static checks and commit**

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm test -- --run \
  src/server/payments/drizzle-payment-repository.test.ts \
  src/server/payments/drizzle-payment-repository.integration.test.ts
npm run db:check
npm run lint
npm run typecheck
git add src/server/payments
git commit -m "feat: persist idempotent payment attempts"
```

---

### Task 5: Local-test providers and registry

**Files:**
- Create: `src/server/payments/local-test-provider.ts`
- Create: `src/server/payments/local-test-provider.test.ts`
- Create: `src/server/payments/provider-registry.ts`
- Create: `src/server/payments/provider-registry.test.ts`

**Interfaces:**
- Consumes: provider contract/config/eligibility.
- Produces: `createLocalTestProvider(method)`, `selectPaymentProviders(config)`.

- [ ] **Step 1: Write safety/idempotency tests**

```ts
expect(() => createLocalTestProvider({ nodeEnv: "production", method: "card" }))
  .toThrow("Local test payments cannot run in production");
expect(await provider.createOrReuse(input)).toMatchObject({
  kind: "test",
  providerStatus: "TEST_REQUIRES_ACTION",
});
expect(await provider.completeReturn(returnInput)).toMatchObject({
  status: "paid",
  amountCents: input.order.amountCents,
  currency: "NZD",
});
```

The test return becomes trusted only after the server matches the stored one-time return-state digest. A browser `result=paid` parameter is ignored.

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- --run \
  src/server/payments/local-test-provider.test.ts \
  src/server/payments/provider-registry.test.ts
```

- [ ] **Step 3: Implement explicit registry selection**

Build card/Afterpay/Zip local variants only when the explicit test flag is enabled. If a real provider is configured, it replaces the matching test method. Labels must read `Test card — no real payment`, `Test Afterpay — no real payment` and `Test Zip — no real payment`. Test Zip follows the same AU-only eligibility.

- [ ] **Step 4: Pass checks and commit**

```bash
npm test -- --run \
  src/server/payments/local-test-provider.test.ts \
  src/server/payments/provider-registry.test.ts
npm run lint
npm run typecheck
git add src/server/payments
git commit -m "feat: add safe local payment adapters"
```

---

### Task 6: Payment service and owner-scoped APIs

**Files:**
- Create: `src/server/payments/payment-service.ts`
- Create: `src/server/payments/payment-service.test.ts`
- Create: `src/app/api/checkout/payment-methods/route.ts`
- Create: `src/app/api/checkout/payment-methods/route.test.ts`
- Create: `src/app/api/orders/[orderNumber]/payment/route.ts`
- Create: `src/app/api/orders/[orderNumber]/payment/route.test.ts`
- Modify: `src/server/orders/order-service.ts`
- Modify: `src/server/orders/order-service.test.ts`
- Modify: `src/app/api/checkout/order/route.ts`
- Modify: `src/app/api/checkout/order/route.test.ts`

**Interfaces:**
- Consumes: immutable order creation result, payment repository, provider registry.
- Produces: `availableMethods(access)`, `start(access, method, idempotencyKey)`.

- [ ] **Step 1: Write orchestration tests**

```ts
const result = await service.start(access, "afterpay", paymentKey);
expect(repository.createOrFindAttempt).toHaveBeenCalledWith(expect.objectContaining({
  expectedAmountCents: 12075,
  currency: "NZD",
}));
expect(provider.createOrReuse).toHaveBeenCalledWith(expect.objectContaining({
  order: expect.objectContaining({ amountCents: 12075 }),
}));
```

Cover inaccessible order, unavailable provider, duplicate start reuse, persisted attempt followed by provider timeout, paid-order retry rejection and retry after a failed attempt.

Add a barrier-controlled concurrency test that calls `start` twice for the same order/method with two different valid browser UUIDs. Assert one persisted nonterminal attempt, one provider `createOrReuse` call, one stable server-derived provider idempotency key, and two responses referring to the same safe action/state. The non-claiming request may poll/reload the bound session but must not create one.

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- --run \
  src/server/payments/payment-service.test.ts \
  src/app/api/checkout/payment-methods/route.test.ts \
  src/app/api/orders/\\[orderNumber\\]/payment/route.test.ts \
  src/app/api/checkout/order/route.test.ts
```

- [ ] **Step 3: Keep internal order ID server-only**

Change the order service result to include `orderId` internally, while the existing route serializer continues to return only order number, currency, total and payment status. No browser DTO contains the database ID.

- [ ] **Step 4: Implement method discovery from persisted checkout**

`POST /api/checkout/payment-methods` accepts only:

```ts
z.object({
  checkoutVersion: z.number().int().positive(),
  cartDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
```

It authorizes the checkout cookie/customer, loads server-owned total/country, verifies the reviewed version/digest and returns public methods. It accepts no amount, currency or address.

- [ ] **Step 5: Implement payment start**

`POST /api/orders/[orderNumber]/payment` accepts:

```ts
z.object({
  method: z.enum(["card", "afterpay", "zip"]),
  idempotencyKey: z.uuid(),
}).strict();
```

It authorizes the guest token or signed-in owner, creates/reuses the one nonterminal attempt, invokes the provider only for the active repository claim, and returns a safe action. The browser UUID deduplicates its own HTTP retry but is never the upstream provider key. Inaccessible orders return `404`; unavailable providers return `503 PAYMENT_UNAVAILABLE`; a provider timeout leaves the unpaid order and persisted attempt recoverable with the same server-derived provider key.

- [ ] **Step 6: Preserve interrupted checkout recovery**

Extend the existing session-storage placement intent with selected method and a distinct payment idempotency key. Replaying order creation reuses the order; replaying payment start reuses the attempt.

- [ ] **Step 7: Pass checks and commit**

```bash
npm test -- --run \
  src/server/orders/order-service.test.ts \
  src/server/payments/payment-service.test.ts \
  src/app/api/checkout/payment-methods/route.test.ts \
  src/app/api/orders/\\[orderNumber\\]/payment/route.test.ts \
  src/app/api/checkout/order/route.test.ts \
  src/app/api/checkout/order/route.integration.test.ts
npm run lint
npm run typecheck
git add src/server/orders src/server/payments src/app/api
git commit -m "feat: start payments from immutable orders"
```

---

### Task 7: Checkout and order payment UI

**Files:**
- Create: `src/components/payment-methods.tsx`
- Create: `src/components/payment-methods.test.tsx`
- Create: `src/components/order-payment-panel.tsx`
- Create: `src/components/order-payment-panel.test.tsx`
- Modify: `src/components/checkout-view.tsx`
- Modify: `src/components/checkout-view.test.tsx`
- Modify: `src/components/storefront.module.css`
- Modify: `src/app/orders/[orderNumber]/page.tsx`
- Modify: `src/app/account/orders/[orderNumber]/page.tsx`
- Modify: `src/app/orders/order-pages.test.tsx`

**Interfaces:**
- Consumes: public method/action/status DTOs.
- Produces: accessible method selection, redirect/retry handling and truthful state copy.

- [ ] **Step 1: Write UI tests**

```tsx
expect(screen.getByRole("radiogroup", { name: "Payment method" })).toBeInTheDocument();
expect(screen.getByRole("radio", { name: "Card" })).toBeChecked();
expect(screen.getByText("Test Afterpay — no real payment")).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Place order" })).toBeDisabled();
```

Changing cart/address/delivery/shipping must clear method authority. Re-review reloads methods. No methods produces `Payment methods are not configured yet` and keeps Place order disabled.

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- --run \
  src/components/payment-methods.test.tsx \
  src/components/order-payment-panel.test.tsx \
  src/components/checkout-view.test.tsx \
  src/app/orders/order-pages.test.tsx
```

- [ ] **Step 3: Implement selection using existing form tokens**

Render a fieldset/radiogroup with at least 44 px targets. Test methods include `No real payment will be taken.` Use existing spacing, button, border and focus tokens; do not introduce a parallel visual system.

- [ ] **Step 4: Implement action/recovery behavior**

- `redirect`: `window.location.assign(action.redirectUrl)`.
- `elements`: navigate to the owning order payment panel.
- failed start: keep the immutable unpaid order, navigate to its page and offer enabled alternatives.
- order response loss: replay the stored placement/payment intent.
- processing: display `Payment confirmation is pending`; never display paid optimistically.

- [ ] **Step 5: Pass checks and commit**

```bash
npm test -- --run \
  src/components/payment-methods.test.tsx \
  src/components/order-payment-panel.test.tsx \
  src/components/checkout-view.test.tsx \
  src/app/orders/order-pages.test.tsx
npm run lint
npm run typecheck
git add src/components src/app/orders src/app/account/orders
git commit -m "feat: add checkout payment selection"
```

---

### Task 8: Stripe PaymentIntent and Elements

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/server/payments/stripe-provider.ts`
- Create: `src/server/payments/stripe-provider.test.ts`
- Create: `src/components/stripe-payment-form.tsx`
- Create: `src/components/stripe-payment-form.test.tsx`
- Modify (created in Task 7): `src/components/order-payment-panel.tsx`

**Interfaces:**
- Consumes: provider contract and immutable order.
- Produces: Stripe `elements` action and client form.

- [ ] **Step 1: Install only official Stripe packages**

```bash
npm install stripe@latest @stripe/stripe-js@latest @stripe/react-stripe-js@latest
```

Record exact resolved versions in the lockfile. Add no other dependency.

- [ ] **Step 2: Write mocked adapter tests**

```ts
expect(stripe.paymentIntents.create).toHaveBeenCalledWith({
  amount: order.amountCents,
  currency: "nzd",
  payment_method_types: ["card"],
  metadata: { order_number: order.orderNumber },
}, { idempotencyKey });
expect(stripe.paymentIntents.create.mock.calls[0]?.[0])
  .not.toHaveProperty("automatic_payment_methods");
```

Cover retrieval/reuse, missing client secret, amount/currency/order mismatch, timeout, and mapping for `succeeded`, `processing`, `requires_payment_method`, `canceled`. The injected mock is the only Stripe client used in tests.

- [ ] **Step 3: Run and confirm failure**

```bash
npm test -- --run \
  src/server/payments/stripe-provider.test.ts \
  src/components/stripe-payment-form.test.tsx
```

- [ ] **Step 4: Implement server adapter and Elements**

Use one PaymentIntent per persisted-attempt-derived idempotency key with `payment_method_types: ["card"]`. Never set `automatic_payment_methods`. Metadata contains order number only. Validate retrieved amount, currency and metadata before normalizing status. Elements calls `stripe.confirmPayment` with a return URL; its result may show a client validation error but never updates order state.

- [ ] **Step 5: Pass checks and commit**

```bash
npm test -- --run \
  src/server/payments/stripe-provider.test.ts \
  src/components/stripe-payment-form.test.tsx \
  src/components/order-payment-panel.test.tsx
npm run lint
npm run typecheck
git add package.json package-lock.json src/server/payments src/components
git commit -m "feat: add Stripe PaymentIntent adapter"
```

---

### Task 9: Afterpay v2 checkout and server capture

**Files:**
- Create: `src/server/payments/provider-http.ts`
- Create: `src/server/payments/provider-http.test.ts`
- Create: `src/server/payments/afterpay-provider.ts`
- Create: `src/server/payments/afterpay-provider.test.ts`

**Interfaces:**
- Consumes: provider contract/config and injected `fetch`.
- Produces: Afterpay redirect session, capture and retrieval mapping.

- [ ] **Step 1: Write HTTP boundary and request tests**

Assert HTTPS-only base URLs, abort timeout, JSON validation and redacted errors. Assert `GET /v2/configuration` limits are checked before `POST /v2/checkouts`; checkout includes exact decimal order amount, NZD, merchant reference and state-bearing confirm/cancel URLs.

```ts
expect(JSON.parse(checkoutRequest.body)).toMatchObject({
  amount: { amount: "120.75", currency: "NZD" },
  merchantReference: order.orderNumber,
  merchant: {
    redirectConfirmUrl: expect.stringContaining("state="),
    redirectCancelUrl: expect.stringContaining("state="),
  },
});
```

- [ ] **Step 2: Write strict capture verification tests**

The returned `status=SUCCESS` only permits the server to call `POST /v2/payments/capture`. Paid requires all of the following from the verified server response: `status === "APPROVED"`, `paymentState === "CAPTURED"`, `openToCaptureAmount.amount === "0.00"`, and exact checkout token, merchant reference, amount and currency matches. Test every condition independently, plus DECLINED and stable request-ID reuse. Any APPROVED response that is not fully captured remains processing/reconciliation; it never becomes paid from the browser return.

- [ ] **Step 3: Run and confirm failure**

```bash
npm test -- --run \
  src/server/payments/provider-http.test.ts \
  src/server/payments/afterpay-provider.test.ts
```

- [ ] **Step 4: Implement using integer-to-decimal conversion**

Format 12075 cents as `120.75` without floating arithmetic. Sandbox/production base URL comes only from the explicit environment enum. Do not log Authorization headers, checkout token or response body.

- [ ] **Step 5: Pass checks and commit**

```bash
npm test -- --run \
  src/server/payments/provider-http.test.ts \
  src/server/payments/afterpay-provider.test.ts \
  src/server/payments/payment-service.test.ts
npm run lint
npm run typecheck
git add src/server/payments
git commit -m "feat: add Afterpay checkout capture adapter"
```

---

### Task 10: Zip AU checkout and server charge

**Files:**
- Create: `src/server/payments/zip-provider.ts`
- Create: `src/server/payments/zip-provider.test.ts`

**Interfaces:**
- Consumes: AU-only eligibility and provider HTTP helper.
- Produces: Zip redirect checkout, server charge and retrieval mapping.

- [ ] **Step 1: Write eligibility/request tests**

```ts
await expect(provider.availability(nzOrder))
  .resolves.toEqual({ available: false, reason: "country" });
await expect(provider.availability(auOrderWithoutApprovedCurrency))
  .resolves.toEqual({ available: false, reason: "currency" });
await expect(provider.availability(auOrderInNzd))
  .resolves.toEqual({ available: false, reason: "currency" });
expect(fetchMock).not.toHaveBeenCalled();

// Adapter contract fixture only; the current site order model cannot produce AUD.
expect(JSON.parse(audCheckoutRequest.body)).toMatchObject({
  shopper: { billing_address: { country: "AU", state: "NSW" } },
  order: { reference: audOrder.orderNumber, amount: 120.75, currency: "AUD" },
});
```

The successful AUD fixture tests the adapter contract in isolation. Never construct a successful NZD Zip request. The end-to-end service/eligibility test for every current NZD order must assert zero Zip HTTP calls, even if merchant configuration contains `NZD`.

- [ ] **Step 2: Write return/charge tests**

A browser `result=Approved` changes no state by itself. It permits a server `POST /charges` only when the returned checkout ID matches the stored provider reference and the one-time state is valid. Assert `authority.type=checkout_id`, `capture=true`, exact amount/currency/reference and a stable Idempotency-Key.

- [ ] **Step 3: Run and confirm failure**

```bash
npm test -- --run src/server/payments/zip-provider.test.ts
```

- [ ] **Step 4: Implement documented successful-state handling**

`captured` with matching captured amount becomes paid. `authorised` or `approved` remains processing until retrieval confirms capture. Declined/referred/expired becomes failed or cancelled. Enforce the provider's 15-minute post-approval charge window. Real eligibility first intersects merchant configuration with the hard provider allowlist `AUD`, `USD`, `CAD`; because persisted site orders are currently fixed to NZD, this implementation retains the adapter but cannot offer or call it in the real checkout.

- [ ] **Step 5: Pass checks and commit**

```bash
npm test -- --run \
  src/server/payments/zip-provider.test.ts \
  src/server/payments/eligibility.test.ts \
  src/server/payments/payment-service.test.ts
npm run lint
npm run typecheck
git add src/server/payments
git commit -m "feat: add AU Zip checkout charge adapter"
```

---

### Task 11: Stripe webhook transaction

**Files:**
- Create: `src/app/api/payments/webhooks/[provider]/route.ts`
- Create: `src/app/api/payments/webhooks/[provider]/route.test.ts`
- Modify (created in Task 6): `src/server/payments/payment-service.ts`
- Modify (created in Task 6): `src/server/payments/payment-service.test.ts`
- Modify (created in Task 4): `src/server/payments/drizzle-payment-repository.ts`
- Modify (created in Task 4): `src/server/payments/drizzle-payment-repository.integration.test.ts`

**Interfaces:**
- Consumes: Stripe raw-body verification and atomic verified-event repository operation.
- Produces: a replay-safe Stripe webhook endpoint.

- [ ] **Step 1: Write webhook tests**

Cover invalid/missing Stripe signature `400`, valid event, duplicate same-hash event `200`, duplicate different-hash `409`, amount/currency/order mismatch `400`, unknown provider `404`, and stale failure after paid remaining paid.

```ts
const raw = new TextEncoder().encode('{"id":"evt_test"}');
await handler(new Request(url, {
  method: "POST",
  headers: { "stripe-signature": signature },
  body: raw,
}));
expect(provider.verifyWebhook).toHaveBeenCalledWith(raw, expect.any(Headers));
```

- [ ] **Step 2: Write transaction fault-injection tests**

After cryptographic verification and normalization, one database transaction must claim the event ID/hash, lock and validate attempt/order/reference/money, apply the monotonic transition and store the processed result. Inject failures after event insert, after transition and immediately before processed-result persistence; each must roll back so replay succeeds exactly once. A committed same-hash duplicate returns the stored result without reapplying; a different-hash duplicate is `409`. If the implementation deliberately retains an unprocessed claim rather than rolling back, the duplicate path must reclaim and finish it instead of returning success prematurely.

```ts
repository.injectFault("after_transition");
await expect(service.applyVerifiedWebhook(event)).rejects.toThrow();
repository.clearFault();
await expect(service.applyVerifiedWebhook(event)).resolves.toBe("applied");
expect(await readEvent(event.id)).toMatchObject({ processedResult: "applied" });
```

- [ ] **Step 3: Implement raw verification and atomic application**

Read `request.arrayBuffer()` exactly once before Stripe verification. Do not call `request.json()` first. Signature verification and normalized event construction happen before repository entry; event claim, locked business validation, attempt/order transition and processed-result write happen in one repository transaction. Afterpay/Zip do not get invented webhook signing contracts.

- [ ] **Step 4: Pass checks and commit**

```bash
npm test -- --run \
  src/app/api/payments/webhooks/\\[provider\\]/route.test.ts \
  src/server/payments/payment-service.test.ts \
  src/server/payments/drizzle-payment-repository.integration.test.ts
npm run lint
npm run typecheck
git add src/app/api src/server/payments
git commit -m "feat: verify Stripe webhooks atomically"
```

---

### Task 12: Atomic one-time redirect returns

**Files:**
- Create: `src/app/api/payments/returns/[provider]/route.ts`
- Create: `src/app/api/payments/returns/[provider]/route.test.ts`
- Modify (created in Task 6): `src/server/payments/payment-service.ts`
- Modify (created in Task 6): `src/server/payments/payment-service.test.ts`
- Modify (created in Task 4): `src/server/payments/drizzle-payment-repository.ts`
- Modify (created in Task 4): `src/server/payments/drizzle-payment-repository.integration.test.ts`

**Interfaces:**
- Consumes: atomic `consumeReturnState`, stored provider reference and server capture/charge adapters.
- Produces: single-use provider return endpoints that never trust query status.

- [ ] **Step 1: Write first-return tests**

- Stripe: valid state redirects to the owned order and leaves current server state; webhook/reconciliation determines payment.
- Afterpay: valid state plus SUCCESS may perform one server capture, then applies only the strict fully-captured result from Task 9.
- Zip: only a synthetically supported AUD adapter fixture may charge; the actual NZD service path is unavailable and makes zero Zip calls.
- Invalid/expired state or mismatched provider/reference returns `404` and performs no provider call.

- [ ] **Step 2: Write duplicate and concurrent-return tests**

Two simultaneous requests for the same return state must produce one successful atomic consume. Only that winner may execute the provider completion call. The loser and every later duplicate make zero external provider calls, redirect to the safe owned-order page/current status, and leave later retrieval to the reconciliation task. Test process restart by using the persisted consumed timestamp rather than memory.

```ts
await Promise.all([handler(returnRequest), handler(returnRequest)]);
expect(provider.completeReturn).toHaveBeenCalledTimes(1);
provider.completeReturn.mockClear();
await handler(returnRequest);
expect(provider.completeReturn).not.toHaveBeenCalled();
```

- [ ] **Step 3: Implement consume-before-call behavior**

Hash the untrusted state, call `consumeReturnState` under row lock, and stop immediately if it is already consumed. Never reset consumption after a provider timeout: the persisted attempt and provider reference are recovered by reconciliation, not by replaying capture/charge. Return URLs never accept amount, currency, order ID or paid status as authority.

- [ ] **Step 4: Pass checks and commit**

```bash
npm test -- --run \
  src/app/api/payments/returns/\\[provider\\]/route.test.ts \
  src/server/payments/payment-service.test.ts \
  src/server/payments/drizzle-payment-repository.integration.test.ts
npm run lint
npm run typecheck
git add src/app/api src/server/payments
git commit -m "feat: consume payment returns once"
```

---

### Task 13: Protected payment reconciliation

**Files:**
- Create: `src/app/api/internal/payments/reconcile/route.ts`
- Create: `src/app/api/internal/payments/reconcile/route.test.ts`
- Modify (created in Task 6): `src/server/payments/payment-service.ts`
- Modify (created in Task 6): `src/server/payments/payment-service.test.ts`

**Interfaces:**
- Consumes: reconciliation candidates and provider `retrieve` results.
- Produces: protected, bounded recovery for processing/timed-out attempts.

- [ ] **Step 1: Write authorization and bound tests**

Missing/wrong bearer returns `401`; missing configured secret returns `503`; correct secret uses a timing-safe comparison and processes at most 50 candidates. One candidate failure is isolated and does not prevent the remaining candidates.

- [ ] **Step 2: Write verified retrieval tests**

Retrieve by stored provider reference only. Exact reference, order number, amount and currency must match before an atomic state transition. Cover Stripe succeeded/processing, Afterpay's strict fully-captured predicate from Task 9, Zip AUD adapter fixtures, stale failure after paid and a provider timeout that remains recoverable. Current NZD Zip attempts cannot be candidates because they cannot be created.

```ts
await reconcile({ limit: 50 });
expect(provider.retrieve).toHaveBeenCalledWith(expect.objectContaining({
  providerReference: persistedAttempt.providerReference,
}));
expect(repository.applyVerifiedResult).toHaveBeenCalledWith(expect.objectContaining({
  expectedAmountCents: persistedAttempt.expectedAmountCents,
  currency: persistedAttempt.currency,
}));
```

- [ ] **Step 3: Implement bounded reconciliation**

The endpoint accepts no order/provider/body authority. It lists server-selected candidates, retrieves each independently and applies the normalized verified result through the repository. Duplicate returns do not call retrieve; this protected reconciliation path owns later retrieval.

- [ ] **Step 4: Pass checks and commit**

```bash
npm test -- --run \
  src/app/api/internal/payments/reconcile/route.test.ts \
  src/server/payments/payment-service.test.ts
npm run lint
npm run typecheck
git add src/app/api src/server/payments
git commit -m "feat: reconcile pending payments"
```

---

### Task 14: Public payment state and owner-scoped order recovery

**Files:**
- Modify: `src/server/orders/order-query-service.ts`
- Modify: `src/server/orders/order-query-service.test.ts`
- Modify: `src/server/orders/drizzle-order-query-repository.ts`
- Modify: `src/server/orders/drizzle-order-query-repository.test.ts`
- Modify: `src/components/order-detail.tsx`
- Modify: `src/app/orders/order-pages.test.tsx`

**Interfaces:**
- Consumes: all payment tasks.
- Produces: safe public payment summary and truthful order-page recovery UI.

- [ ] **Step 1: Add public projection tests**

```ts
expect(publicOrder.payment).toEqual({
  method: "afterpay",
  status: "processing",
  canRetry: false,
  isTest: false,
});
expect(publicOrder).not.toHaveProperty("providerReference");
expect(JSON.stringify(publicOrder)).not.toContain("secret");
```

Order pages show awaiting/retry, processing, paid, failed and cancelled truthfully. Another guest/account remains not found.

- [ ] **Step 2: Add order-page state tests**

Cover awaiting/retry, processing, paid, failed and cancelled copy. A paid order has no retry action. A processing order says `Payment confirmation is pending`. Another guest/account remains not found and does not receive attempt details.

- [ ] **Step 3: Implement the minimal public projection**

Return method, normalized status, canRetry and isTest only. Never expose provider reference, attempt ID, client secret, return state, failure body or event ID.

- [ ] **Step 4: Pass focused checks and commit**

```bash
npm test -- --run \
  src/server/orders/order-query-service.test.ts \
  src/server/orders/drizzle-order-query-repository.test.ts \
  src/app/orders/order-pages.test.tsx \
  src/components/order-payment-panel.test.tsx
npm run lint
npm run typecheck
git add src/server/orders src/components src/app/orders src/app/account/orders
git commit -m "feat: show verified order payment state"
```

---

### Task 15: Full integration and real-browser acceptance

**Files:**
- Create: `docs/audits/next-payments-real-browser-2026-08-02/report.md`
- Create: screenshots under `docs/audits/next-payments-real-browser-2026-08-02/`
- Modify only after reproducing an acceptance defect: the directly owning file and a focused regression test.

**Interfaces:**
- Consumes: all implementation tasks.
- Produces: verified local-test evidence and a clean worktree.

- [ ] **Step 1: Start and migrate a disposable PostgreSQL database**

```bash
docker run --rm --name rnr-next-payment-test \
  -e POSTGRES_USER=rnr_test \
  -e POSTGRES_PASSWORD=rnr_test \
  -e POSTGRES_DB=rnr_test \
  -p 127.0.0.1:55443:5432 -d postgres:16
DATABASE_URL='postgresql://rnr_test:rnr_test@127.0.0.1:55443/rnr_test' npm run db:migrate
```

- [ ] **Step 2: Run full automated verification**

```bash
TEST_DATABASE_URL='postgresql://rnr_test:rnr_test@127.0.0.1:55443/rnr_test' npm test -- --run
npm run lint
npm run typecheck
DATABASE_URL='postgresql://rnr_test:rnr_test@127.0.0.1:55443/rnr_test' npm run db:check
git diff --check
```

- [ ] **Step 3: Build with empty real credentials**

```bash
DATABASE_URL='postgresql://rnr_test:rnr_test@127.0.0.1:55443/rnr_test' \
BETTER_AUTH_URL='https://example.test' \
BETTER_AUTH_SECRET='test-only-secret-not-for-production' \
ENABLE_LOCAL_TEST_PAYMENTS='false' \
npm run build
```

Expected: build passes; real methods are disabled and no external request occurs.

- [ ] **Step 4: Run local-test browser acceptance at 390, 820 and 1440 px**

Verify product → cart → NZ/AU address → shipping review → payment method → immutable order for Test card, Test Afterpay and explicitly test-only Zip. Confirm:

- real Zip is never shown for current NZD orders in either NZ or AU and captured provider-host logs contain zero Zip requests;
- test labels are explicit;
- changing address/cart/shipping invalidates payment method authority;
- browser return alone is not paid;
- server local capture/reconciliation can become paid;
- response loss reuses one order/attempt;
- two independent browser contexts using different client UUIDs for the same order/method cause one nonterminal attempt and one provider-session create;
- simultaneous and repeated return URLs consume state once; duplicate requests make zero provider calls and reconciliation retrieves later if needed;
- foreign guest/account receives not found;
- targets are at least 44 px, focus visible, no overflow, no application console errors.

No real credentials, card data or provider URL is used.

- [ ] **Step 5: Verify incomplete credentials fail closed**

Run once with no credentials and once for each partial credential group. The UI must show no corresponding real method, Place order must not claim that method, and captured network logs must contain zero Stripe/Afterpay/Zip hosts.

- [ ] **Step 6: Write evidence and stop resources**

Report viewports, states, attempt/event counts, provider-create counts, duplicate-return outcome, console/network outcome, commands and limitations. Explicitly state no external request/payment occurred, real Zip was unavailable for all current NZD orders, and real sandbox certification still requires credentials/onboarding plus a supported order currency.

```bash
docker stop rnr-next-payment-test
git status --short
```

- [ ] **Step 7: Commit**

```bash
git add docs/audits/next-payments-real-browser-2026-08-02
git commit -m "docs: record payment browser acceptance"
```

---

## Commit Boundaries

1. `feat: add payment persistence schema`
2. `feat: define payment provider contract`
3. `feat: gate payment provider eligibility`
4. `feat: persist idempotent payment attempts`
5. `feat: add safe local payment adapters`
6. `feat: start payments from immutable orders`
7. `feat: add checkout payment selection`
8. `feat: add Stripe PaymentIntent adapter`
9. `feat: add Afterpay checkout capture adapter`
10. `feat: add AU Zip checkout charge adapter`
11. `feat: verify Stripe webhooks atomically`
12. `feat: consume payment returns once`
13. `feat: reconcile pending payments`
14. `feat: show verified order payment state`
15. `docs: record payment browser acceptance`

Each commit runs its focused tests, lint and typecheck. Schema, provider, callback and UI work remain separately reviewable.

## Security Invariants

- [ ] Payment amount/currency/reference match the immutable order before state change.
- [ ] One nonterminal attempt exists per order/provider/method, including concurrent starts with different browser UUIDs.
- [ ] Provider idempotency derives stably from the persisted attempt and operation, never browser UUIDs or totals.
- [ ] One provider event ID/hash, locked validation, transition and processed result commit atomically; different-hash replay is rejected and injected faults are replayable.
- [ ] Stripe raw bytes are verified before JSON interpretation.
- [ ] Stripe PaymentIntent explicitly uses card-only method types and never automatic payment methods.
- [ ] Return routes atomically consume one-time state plus stored provider reference; duplicate returns make zero provider calls.
- [ ] Browser return cannot propose paid.
- [ ] Afterpay becomes paid only when approved, captured, zero open-to-capture and all stored identifiers/money match.
- [ ] Paid cannot be overwritten by stale failure/processing.
- [ ] Paid order cannot start another charge.
- [ ] Guest token/account authorization protects start and status.
- [ ] Missing/partial credentials disable the provider.
- [ ] Local adapters cannot initialize in production.
- [ ] Zip v2 hard currency allowlist is AUD/USD/CAD intersected with merchant configuration; current fixed-NZD orders never offer or call real Zip.
- [ ] Every provider declares `refundCapability`; this plan adds no refund operation.
- [ ] Secrets, client secrets, raw payloads, card data and PII are absent from logs/audit tables.
- [ ] Automated/browser tests make zero real external calls.

## Self-review

- Spec coverage: schema, contract/refund capability, local tests, API/UI, Stripe, strict Afterpay capture, Zip currency reality, atomic webhook, one-time returns, reconciliation, cross-browser idempotency, eligibility and browser acceptance all have a commit-sized task.
- Minimal closure: no refund administration, multi-currency conversion, invented Afterpay/Zip webhook signature or WordPress integration is added.
- Type order: shared provider/result/repository contracts appear before provider/API/UI consumers.
- Zip reality: official v2 charge supports AUD/USD/CAD only. Merchant configuration can narrow but never expand that set; because current orders persist NZD, real Zip is unavailable for both NZ and AU and performs zero external calls.
- External safety: provider clients are injected/mocked and the acceptance task uses only explicit non-production local adapters.
