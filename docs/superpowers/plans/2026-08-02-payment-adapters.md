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
- Do not store/log card data, secrets, client secrets, raw webhook payloads or PII.
- Zip is never offered for NZ. AU Zip additionally requires explicit AU merchant credentials and an approved currency list containing the persisted order currency.
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
11. Webhook/return/reconciliation
12. Public payment-state projection
13. Browser acceptance and evidence

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

`payment_attempts` contains order ID, provider, method, idempotency key, optional provider reference, one-time return-state digest, expected amount/currency, country, status, sanitized failure code and timestamps. `webhook_events` contains provider, provider event ID, SHA-256, optional attempt ID, processing result and timestamps. It does not contain raw payloads.

Add:

- unique `(provider, idempotency_key)`;
- unique nullable `(provider, provider_reference)`;
- positive expected amount check;
- composite order-money FK from attempt `(order_id, expected_amount_cents, currency)` to a new unique order key `(id, total_incl_gst_cents, currency)`;
- unique `(provider, provider_event_id)`;
- SHA-256 format check.

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
  currency: "NZD";
  country: "NZ" | "AU";
  customer: Readonly<{ fullName: string; email: string; phone: string }>;
  billingAddress: NormalizedAddress;
  deliveryAddress: NormalizedAddress;
}>;

export interface PaymentProvider {
  readonly key: PaymentProviderKey;
  readonly method: PaymentMethodKey;
  availability(order: PaymentOrder): Promise<ProviderAvailability>;
  createOrReuse(input: CreateProviderSessionInput): Promise<ProviderSession>;
  completeReturn(input: CompleteProviderReturnInput): Promise<VerifiedPaymentResult>;
  retrieve(input: RetrieveProviderPaymentInput): Promise<VerifiedPaymentResult>;
  verifyWebhook?(rawBody: Uint8Array, headers: Headers): Promise<VerifiedProviderEvent>;
}
```

`ProviderSession` is a discriminated union: `elements` with transient Stripe client secret, `redirect` with redirect URL, or `test` with a local URL. `VerifiedPaymentResult` always includes provider reference/status, amount, currency, order number and normalized status.

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
```

Also assert AU Zip is unavailable unless `ZIP_MERCHANT_COUNTRY=AU`, credentials are complete and `ZIP_ALLOWED_CURRENCIES` contains the persisted order currency. Current NZD orders are not converted.

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
- Zip: delivery country AU, merchant country AU, complete credentials and approved currency. NZ is always false.
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
  createOrFindAttempt(input: CreatePaymentAttemptInput): Promise<PaymentAttemptRecord>;
  bindProviderSession(input: BindProviderSessionInput): Promise<PaymentAttemptRecord>;
  findAttemptByReturnStateDigest(provider: PaymentProviderKey, digest: string): Promise<PaymentAttemptWithOrder | null>;
  recordVerifiedEvent(input: VerifiedEventInput): Promise<"inserted" | "duplicate" | "hash_mismatch">;
  applyVerifiedResult(input: ApplyVerifiedResultInput): Promise<PaymentAttemptWithOrder>;
  listReconciliationCandidates(limit: number): Promise<readonly PaymentAttemptWithOrder[]>;
}
```

Test two simultaneous identical starts create one row; same event/hash applies once; same event/different hash is rejected; wrong guest token/customer returns null; amount/currency/reference mismatch changes no state.

- [ ] **Step 2: Run and confirm failure**

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm test -- --run \
  src/server/payments/drizzle-payment-repository.test.ts \
  src/server/payments/drizzle-payment-repository.integration.test.ts
```

- [ ] **Step 3: Implement row locking and atomic transition**

Inside a transaction, lock the order and selected attempt with `FOR UPDATE`, validate immutable order fields, call `nextOrderPaymentStatus`, then update attempt and order together. Store only sanitized failure codes.

- [ ] **Step 4: Pass DB/static checks and commit**

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

It authorizes the guest token or signed-in owner, creates/reuses an attempt, invokes one provider and returns a safe action. Inaccessible orders return `404`; unavailable providers return `503 PAYMENT_UNAVAILABLE`; a provider timeout leaves the unpaid order and persisted attempt recoverable.

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
  automatic_payment_methods: { enabled: true },
  metadata: { order_number: order.orderNumber },
}, { idempotencyKey });
```

Cover retrieval/reuse, missing client secret, amount/currency/order mismatch, timeout, and mapping for `succeeded`, `processing`, `requires_payment_method`, `canceled`. The injected mock is the only Stripe client used in tests.

- [ ] **Step 3: Run and confirm failure**

```bash
npm test -- --run \
  src/server/payments/stripe-provider.test.ts \
  src/components/stripe-payment-form.test.tsx
```

- [ ] **Step 4: Implement server adapter and Elements**

Use one PaymentIntent per order-derived idempotency key. Metadata contains order number only. Validate retrieved amount, currency and metadata before normalizing status. Elements calls `stripe.confirmPayment` with a return URL; its result may show a client validation error but never updates order state.

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

- [ ] **Step 2: Write capture verification tests**

The returned `status=SUCCESS` only permits the server to call `POST /v2/payments/capture`. Test APPROVED/DECLINED, token mismatch, merchant-reference mismatch, amount/currency mismatch and idempotent request ID reuse. Only matching APPROVED capture becomes paid.

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
expect(JSON.parse(checkoutRequest.body)).toMatchObject({
  shopper: { billing_address: { country: "AU", state: "NSW" } },
  order: { reference: order.orderNumber, amount: 120.75, currency: "NZD" },
});
```

- [ ] **Step 2: Write return/charge tests**

A browser `result=Approved` changes no state by itself. It permits a server `POST /charges` only when the returned checkout ID matches the stored provider reference and the one-time state is valid. Assert `authority.type=checkout_id`, `capture=true`, exact amount/currency/reference and a stable Idempotency-Key.

- [ ] **Step 3: Run and confirm failure**

```bash
npm test -- --run src/server/payments/zip-provider.test.ts
```

- [ ] **Step 4: Implement documented successful-state handling**

`captured` with matching captured amount becomes paid. `authorised` or `approved` remains processing until retrieval confirms capture. Declined/referred/expired becomes failed or cancelled. Enforce the provider's 15-minute post-approval charge window.

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

### Task 11: Verified webhook, return and reconciliation paths

**Files:**
- Create: `src/app/api/payments/webhooks/[provider]/route.ts`
- Create: `src/app/api/payments/webhooks/[provider]/route.test.ts`
- Create: `src/app/api/payments/returns/[provider]/route.ts`
- Create: `src/app/api/payments/returns/[provider]/route.test.ts`
- Create: `src/app/api/internal/payments/reconcile/route.ts`
- Create: `src/app/api/internal/payments/reconcile/route.test.ts`
- Modify (created in Task 6): `src/server/payments/payment-service.ts`
- Modify (created in Task 6): `src/server/payments/payment-service.test.ts`

**Interfaces:**
- Consumes: provider verification, one-time state, event dedupe and reconciliation candidates.
- Produces: Stripe raw-body webhook, provider returns and protected reconciliation.

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

- [ ] **Step 2: Write return tests**

- Stripe: valid state redirects to owned order and leaves current server state.
- Afterpay: SUCCESS plus valid state invokes capture; cancel does not.
- Zip: Approved plus matching checkout ID and state invokes charge.
- Invalid/expired state or mismatched provider reference returns `404` and performs no provider call.

- [ ] **Step 3: Write reconciliation authorization tests**

Missing/wrong bearer returns `401`; missing configured secret returns `503`; correct secret uses a timing-safe comparison and processes at most 50 candidates. Each candidate failure is isolated.

- [ ] **Step 4: Implement raw verification and bounded reconciliation**

Read `request.arrayBuffer()` exactly once before Stripe verification. Do not call `request.json()` first. Afterpay/Zip do not get invented webhook signing: they reach paid through server capture/charge and retrieval reconciliation until official merchant documentation supplies a signing contract.

- [ ] **Step 5: Pass checks and commit**

```bash
npm test -- --run \
  src/app/api/payments/webhooks/\\[provider\\]/route.test.ts \
  src/app/api/payments/returns/\\[provider\\]/route.test.ts \
  src/app/api/internal/payments/reconcile/route.test.ts \
  src/server/payments/payment-service.test.ts
npm run lint
npm run typecheck
git add src/app/api src/server/payments
git commit -m "feat: verify payment callbacks and reconcile"
```

---

### Task 12: Public payment state and owner-scoped order recovery

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

### Task 13: Full integration and real-browser acceptance

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

Verify product → cart → NZ/AU address → shipping review → payment method → immutable order for Test card, Test Afterpay and AU-only Test Zip. Confirm:

- NZ never shows Zip;
- test labels are explicit;
- changing address/cart/shipping invalidates payment method authority;
- browser return alone is not paid;
- server local capture/reconciliation can become paid;
- response loss reuses one order/attempt;
- foreign guest/account receives not found;
- targets are at least 44 px, focus visible, no overflow, no application console errors.

No real credentials, card data or provider URL is used.

- [ ] **Step 5: Verify incomplete credentials fail closed**

Run once with no credentials and once for each partial credential group. The UI must show no corresponding real method, Place order must not claim that method, and captured network logs must contain zero Stripe/Afterpay/Zip hosts.

- [ ] **Step 6: Write evidence and stop resources**

Report viewports, states, attempt/event counts, console/network outcome, commands and limitations. Explicitly state no external request/payment occurred, Zip NZ was unavailable, and real sandbox certification still requires credentials/onboarding.

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
11. `feat: verify payment callbacks and reconcile`
12. `feat: show verified order payment state`
13. `docs: record payment browser acceptance`

Each commit runs its focused tests, lint and typecheck. Schema, provider, callback and UI work remain separately reviewable.

## Security Invariants

- [ ] Payment amount/currency/reference match the immutable order before state change.
- [ ] Provider idempotency derives from the persisted attempt, not browser totals.
- [ ] One provider event ID/hash is applied once; different-hash replay is rejected.
- [ ] Stripe raw bytes are verified before JSON interpretation.
- [ ] Return routes verify one-time state plus stored provider reference.
- [ ] Browser return cannot propose paid.
- [ ] Paid cannot be overwritten by stale failure/processing.
- [ ] Paid order cannot start another charge.
- [ ] Guest token/account authorization protects start and status.
- [ ] Missing/partial credentials disable the provider.
- [ ] Local adapters cannot initialize in production.
- [ ] Zip is never offered for NZ; AU requires explicit merchant/currency eligibility.
- [ ] Secrets, client secrets, raw payloads, card data and PII are absent from logs/audit tables.
- [ ] Automated/browser tests make zero real external calls.

## Self-review

- Spec coverage: schema, contract, local tests, API/UI, Stripe, Afterpay, Zip, callbacks, idempotency, reconciliation, eligibility and browser acceptance all have a commit-sized task.
- Minimal closure: no refund administration, multi-currency conversion, invented Afterpay/Zip webhook signature or WordPress integration is added.
- Type order: shared provider/result/repository contracts appear before provider/API/UI consumers.
- Zip reality: NZ is disabled; AU is also unavailable until explicit merchant credentials and approved persisted currency exist.
- External safety: provider clients are injected/mocked and the acceptance task uses only explicit non-production local adapters.
