# Afterpay Payment Method Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer abandon an incomplete Afterpay checkout and pay the same existing order by card without re-entering checkout details or risking two merchant captures.

**Architecture:** Treat the persisted payment attempt and provider retrieval as authority. An official Afterpay cancellation with no payment record becomes terminal `cancelled`; a new `change_method` order-payment action performs the same server-side authority check for browser-back cases. The order page unlocks only after the server returns a retryable terminal state, while an abandoned attempt is prevented from later capturing through its browser return.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Vitest/Testing Library, Drizzle/PostgreSQL payment repository, Afterpay v2 API.

## Global Constraints

- Do not change order totals, GST, shipping, discounts, currency, or immutable order pricing snapshots.
- Do not change completed or captured payments.
- Do not change Afterpay credentials, merchant configuration, Stripe confirmation, or Stripe capture behavior.
- Keep Guest and authenticated order ownership checks unchanged.
- Keep the durable pending checkout and retained cart association until payment is confirmed.
- Do not implement Stripe Express Checkout in this plan.
- Do not add dependencies.
- Do not run `npm audit fix --force`.

## File map

- `src/server/payments/afterpay-provider.ts`: map an official cancelled return plus authoritative absence to `cancelled`.
- `src/server/payments/afterpay-provider.test.ts`: provider return regression coverage.
- `src/server/payments/payment-service.ts`: add the authority-checked method-change operation and suppress capture from an already abandoned attempt.
- `src/server/payments/payment-service.test.ts`: service security, authority, and idempotency coverage.
- `src/app/api/orders/[orderNumber]/payment/route-handler.ts`: accept the strict `change_method` action and preserve the existing order access boundary.
- `src/app/api/orders/[orderNumber]/payment/route.test.ts`: route validation and ownership coverage.
- `src/components/order-payment-panel.tsx`: expose `Change payment method`, request server verification, clear only the attempt recovery record, and default a cancelled Afterpay retry to Card.
- `src/components/order-payment-panel.test.tsx`: browser-back, cancel-return, method restoration, retained checkout, and new-key coverage.

---

### Task 1: Make the official Afterpay cancellation retryable

**Files:**
- Modify: `src/server/payments/afterpay-provider.test.ts`
- Modify: `src/server/payments/afterpay-provider.ts`

**Interfaces:**
- Consumes: `PaymentProvider.completeReturn(input): Promise<VerifiedPaymentResult>` and the existing authoritative `GET /v2/payments/token/:token` result.
- Produces: a `VerifiedPaymentResult` with `status: "cancelled"` and `providerStatus: "CANCELLED:NOT_FOUND"` only for a valid `CANCELLED` return whose provider retrieval is authoritative absence.

- [ ] **Step 1: Replace the current cancellation regression expectation with a failing retryable expectation**

Update the existing test named `treats a forged browser cancellation with authoritative absence as processing` to state the intended bounded behavior:

```ts
it("treats an official cancellation with authoritative absence as cancelled", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "not found" }, 404));
  const provider = createAfterpayProvider({ config: config(), fetchImpl });

  await expect(provider.completeReturn(completeInput(order(), "CANCELLED")))
    .resolves.toMatchObject({
      providerReference: token,
      providerStatus: "CANCELLED:NOT_FOUND",
      status: "cancelled",
    });
  expect(fetchImpl).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- --run src/server/payments/afterpay-provider.test.ts
```

Expected: FAIL because the provider currently returns `providerStatus: "NOT_FOUND"` and `status: "processing"`.

- [ ] **Step 3: Add a dedicated cancelled-absence result**

Add next to `absentResult`:

```ts
function cancelledAbsentResult(order: PaymentOrder, providerReference: string) {
  return Object.freeze({
    providerReference,
    providerStatus: "CANCELLED:NOT_FOUND",
    amountCents: order.amountCents,
    currency: order.currency,
    orderNumber: order.orderNumber,
    status: "cancelled" as const,
  });
}
```

In `completeReturn`, when `browserStatus === "CANCELLED"` and `retrieveAuthority` returns `authoritative_absence`, return `cancelledAbsentResult`. Continue to use provider authority whenever a payment exists, and keep the successful-return capture path unchanged.

- [ ] **Step 4: Run the provider tests and verify GREEN**

Run:

```bash
npm test -- --run src/server/payments/afterpay-provider.test.ts src/server/payments/eligibility.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the provider behavior**

```bash
git add src/server/payments/afterpay-provider.ts src/server/payments/afterpay-provider.test.ts
git commit -m "fix: make cancelled Afterpay checkout retryable"
```

---

### Task 2: Add a server-authoritative method-change operation

**Files:**
- Modify: `src/server/payments/payment-service.test.ts`
- Modify: `src/server/payments/payment-service.ts`

**Interfaces:**
- Consumes: `PaymentRepository.findCurrentPayment`, `PaymentProvider.retrieve`, and `PaymentRepository.applyVerifiedResult`.
- Produces: `paymentService.changePaymentMethod(access): Promise<PaymentConfirmationResult>`.

- [ ] **Step 1: Write failing service tests**

Add focused tests that prove:

```ts
await expect(paymentService.changePaymentMethod(access)).resolves.toEqual({
  payment: { method: "afterpay", status: "cancelled", isTest: false, canRetry: true },
  orderNumber: order.orderNumber,
});
expect(afterpay.retrieve).toHaveBeenCalledWith({
  order,
  providerReference: boundAttempt.providerReference,
});
expect(applyVerifiedResult).toHaveBeenCalledWith({
  attemptId: boundAttempt.id,
  result: expect.objectContaining({
    providerReference: boundAttempt.providerReference,
    providerStatus: "ABANDONED:NOT_FOUND",
    status: "cancelled",
  }),
  source: "reconciliation",
});
```

Also add separate tests for:

- provider `verified` processing or paid results are applied instead of cancelled;
- provider request errors return `PAYMENT_UNAVAILABLE` and do not call `applyVerifiedResult`;
- Card attempts, missing provider references, terminal attempts, and missing orders are rejected;
- a stored attempt already marked cancelled is ignored by `handleReturn` before `completeReturn` is called.

- [ ] **Step 2: Run the service test and verify RED**

Run:

```bash
npm test -- --run src/server/payments/payment-service.test.ts
```

Expected: FAIL because `changePaymentMethod` does not exist and cancelled attempts are not short-circuited in `handleReturn`.

- [ ] **Step 3: Implement `changePaymentMethod`**

Add this method to the object returned by `createPaymentService`:

```ts
async changePaymentMethod(
  access: PaymentOrderAccess,
): Promise<PaymentConfirmationResult> {
  const current = await repository.findCurrentPayment(access);
  if (
    !current ||
    current.attempt.provider !== "afterpay" ||
    current.attempt.method !== "afterpay" ||
    !current.attempt.providerReference ||
    !["created", "requires_action", "processing"].includes(current.attempt.status)
  ) {
    throw new PaymentServiceError("PAYMENT_UNAVAILABLE", "Payment method cannot be changed");
  }

  const registration = byMethod.get("afterpay");
  if (!registration || registration.provider.key !== "afterpay") throw unavailableStart();

  let authority;
  try {
    authority = await registration.provider.retrieve({
      order: providerPaymentOrder(current.order),
      providerReference: current.attempt.providerReference,
    });
  } catch {
    throw unavailableStart();
  }

  const result = authority.kind === "verified"
    ? authority.result
    : authority.kind === "authoritative_not_found"
      ? {
          providerReference: current.attempt.providerReference,
          providerStatus: "ABANDONED:NOT_FOUND",
          amountCents: current.order.amountCents,
          currency: current.order.currency,
          orderNumber: current.order.orderNumber,
          status: "cancelled" as const,
        }
      : null;
  if (!result) throw unavailableStart();

  const applied = await repository.applyVerifiedResult({
    attemptId: current.attempt.id,
    result,
    source: "reconciliation",
  });
  return Object.freeze({
    payment: publicPayment(applied.attempt.method, applied.attempt.status, registration.isTest),
    orderNumber: applied.order.orderNumber,
  });
}
```

Before calling `completeReturn` in `handleReturn`, return the order number without provider capture when the consumed stored attempt is already `cancelled`. This makes an abandoned Afterpay redirect incapable of later initiating capture without changing the handling of other terminal states.

- [ ] **Step 4: Run service and state-machine tests and verify GREEN**

Run:

```bash
npm test -- --run src/server/payments/payment-service.test.ts src/server/payments/state-machine.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the service operation**

```bash
git add src/server/payments/payment-service.ts src/server/payments/payment-service.test.ts
git commit -m "feat: verify and abandon incomplete Afterpay attempts"
```

---

### Task 3: Expose the strict order-payment API action

**Files:**
- Modify: `src/app/api/orders/[orderNumber]/payment/route.test.ts`
- Modify: `src/app/api/orders/[orderNumber]/payment/route-handler.ts`

**Interfaces:**
- Consumes: `paymentService.changePaymentMethod(access)` from Task 2.
- Produces: `POST /api/orders/:orderNumber/payment` with exact body `{ "action": "change_method" }` and the existing public confirmation response shape.

- [ ] **Step 1: Write failing route tests**

Add `changePaymentMethod: vi.fn()` to the route dependency and verify:

```ts
const response = await route(request({ action: "change_method" }), context);
expect(response.status).toBe(200);
expect(changePaymentMethod).toHaveBeenCalledWith(expectedGuestAccess);
expect(await response.json()).toEqual({
  payment: { method: "afterpay", status: "cancelled", isTest: false, canRetry: true },
  orderNumber: "08000",
});
```

Add tests showing extra fields, an invalid action, and an unauthorised order are rejected through the existing 400/404 boundary.

- [ ] **Step 2: Run the route test and verify RED**

Run:

```bash
npm test -- --run 'src/app/api/orders/[orderNumber]/payment/route.test.ts'
```

Expected: FAIL because the input schema and dependency interface do not support `change_method`.

- [ ] **Step 3: Implement the strict action**

Extend `inputSchema` with:

```ts
z.object({ action: z.literal("change_method") }).strict()
```

Add `changePaymentMethod` to `PaymentStarter`. In the access loop, branch before `confirm`:

```ts
if (input.action === "change_method") {
  const result = await deps.paymentService.changePaymentMethod(access);
  return json({
    payment: publicPayment(result.payment),
    orderNumber: result.orderNumber,
  });
}
```

Do not accept a provider reference, amount, status, or currency from the browser.

- [ ] **Step 4: Run route and mutation-boundary tests and verify GREEN**

Run:

```bash
npm test -- --run 'src/app/api/orders/[orderNumber]/payment/route.test.ts' src/server/http/mutation-request.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the API action**

```bash
git add 'src/app/api/orders/[orderNumber]/payment/route-handler.ts' 'src/app/api/orders/[orderNumber]/payment/route.test.ts'
git commit -m "feat: expose safe payment method change action"
```

---

### Task 4: Restore Card on the existing order page

**Files:**
- Modify: `src/components/order-payment-panel.test.tsx`
- Modify: `src/components/order-payment-panel.tsx`

**Interfaces:**
- Consumes: `{ action: "change_method" }` API from Task 3 and existing `PublicPaymentDTO` validation.
- Produces: a `Change payment method` action for locked Afterpay attempts and Card-first retry after cancellation.

- [ ] **Step 1: Write failing component tests**

Add tests that render an unresolved Afterpay attempt and assert:

```ts
expect(screen.getByRole("button", { name: "Change payment method" })).toBeEnabled();
fireEvent.click(screen.getByRole("button", { name: "Change payment method" }));
await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
  "/api/orders/RNR-2026-ABC/payment",
  expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ action: "change_method" }),
  }),
));
```

Cover these outcomes separately:

- cancelled response clears only the order's starting-attempt session record, retains the durable pending checkout/cart association, and calls `refresh`;
- processing response retains the lock and shows a truthful processing message;
- request failure retains the lock and displays `Payment status could not be confirmed. Try again shortly.`;
- Card and local-test attempts do not show the action;
- a cancelled Afterpay attempt renders all methods with Card selected;
- starting Card after cancellation uses a new idempotency key rather than the old Afterpay key.

- [ ] **Step 2: Run the component test and verify RED**

Run:

```bash
npm test -- --run src/components/order-payment-panel.test.tsx
```

Expected: FAIL because the button, API call, and Card-first cancellation default do not exist.

- [ ] **Step 3: Implement the client action**

Add a strict response parser by reusing the existing payment DTO validation. Add `changeMethod`:

```ts
async function changeMethod() {
  if (pending || lockedMethod !== "afterpay") return;
  setPending(true);
  setMessage("Checking Afterpay payment status…");
  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}/payment`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ action: "change_method" }),
    });
    const result = await parseConfirmedPaymentResponse(response);
    if (result.payment.status === "cancelled" || result.payment.status === "failed") {
      clearStoredStartingAttempt(orderNumber);
      paymentKey.current = null;
    }
    refresh();
  } catch {
    setMessage("Payment status could not be confirmed. Try again shortly.");
  } finally {
    setPending(false);
  }
}
```

Render the secondary button only for `lockedMethod === "afterpay"`. Disable it together with the continuation button while verification runs.

Change the retry preference so a cancelled Afterpay attempt does not force Afterpay:

```ts
const preferredMethod = lockedMethod ?? (
  payment?.canRetry && !(payment.method === "afterpay" && payment.status === "cancelled")
    ? payment.method
    : null
);
```

`defaultMethod(methods)` then selects Card when it is available.

- [ ] **Step 4: Run component and checkout-recovery tests and verify GREEN**

Run:

```bash
npm test -- --run src/components/order-payment-panel.test.tsx src/components/payment-recovery-intent.test.ts src/components/checkout-view.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the customer flow**

```bash
git add src/components/order-payment-panel.tsx src/components/order-payment-panel.test.tsx
git commit -m "fix: let customers change from incomplete Afterpay"
```

---

### Task 5: Verify the payment boundary and release candidate

**Files:**
- Verify only; do not add unrelated files.

**Interfaces:**
- Consumes: all Tasks 1-4.
- Produces: a verified commit suitable for preview deployment.

- [ ] **Step 1: Run focused payment tests**

```bash
npm test -- --run \
  src/server/payments/afterpay-provider.test.ts \
  src/server/payments/payment-service.test.ts \
  src/server/payments/state-machine.test.ts \
  'src/app/api/orders/[orderNumber]/payment/route.test.ts' \
  'src/app/api/payments/returns/[provider]/route.test.ts' \
  src/components/order-payment-panel.test.tsx \
  src/components/payment-recovery-intent.test.ts \
  src/components/checkout-view.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run identity and checkout isolation tests**

```bash
npm test -- --run \
  src/infrastructure/cart/browser-cart-scope.test.ts \
  src/infrastructure/cart/browser-cart-repository.test.ts \
  src/components/account-sign-out.test.tsx \
  src/components/auth-form.test.tsx
```

Expected: PASS. If a named test path has moved, use `rg --files | rg 'browser-cart|account-sign-out|auth-form'` and run the exact current files; do not omit the category.

- [ ] **Step 3: Run static verification**

```bash
npm run typecheck
npm run lint
```

Expected: both exit 0.

- [ ] **Step 4: Run all executable non-database tests**

```bash
npm test -- --run \
  --exclude '**/*.integration.test.ts' \
  --exclude 'src/server/addresses/drizzle-address-repository.test.ts' \
  --exclude 'src/server/checkout/drizzle-checkout-repository.test.ts'
```

Expected: PASS. Report database suites separately if `TEST_DATABASE_URL` is unavailable.

- [ ] **Step 5: Run the production build**

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 6: Inspect the release boundary**

```bash
git status --short --branch
git diff --check origin/feat/payment-adapters...HEAD
git log --oneline origin/feat/payment-adapters..HEAD
```

Expected: only intentional commits are ahead; unrelated untracked files remain excluded.

---

### Task 6: Preview and production smoke validation

**Files:**
- Deployment and browser verification only.

**Interfaces:**
- Consumes: the verified release candidate from Task 5.
- Produces: a Ready preview artifact and, only after checks pass, the same artifact promoted to production.

- [ ] **Step 1: Push the exact branch commit**

```bash
git push origin HEAD:feat/payment-adapters
```

Record the exact commit SHA.

- [ ] **Step 2: Deploy and wait for a Ready preview**

Use the linked Vercel project and confirm the preview artifact was built from the exact pushed commit. Do not promote a failed or different artifact.

- [ ] **Step 3: Run protected-preview route smoke checks**

Use `vercel curl` for protected preview routes. Verify `/`, `/shop`, `/checkout`, and one owned unpaid order flow without exposing customer data.

- [ ] **Step 4: Run same-browser Afterpay cancellation tests**

With a fresh synthetic unpaid order:

1. choose Afterpay and reach the production Afterpay portal;
2. cancel and return;
3. verify the same order number, total, address, and delivery remain;
4. verify Card and Afterpay are visible and Card is selected;
5. start Card and verify the Stripe form is created for the same order;
6. do not complete a real payment;
7. repeat with browser back and `Change payment method`;
8. verify the test order is never marked paid.

- [ ] **Step 5: Promote the exact Ready artifact**

Promote only after preview checks pass. Verify `rrgallery.co.nz` and `www.rrgallery.co.nz` aliases point to the promoted artifact.

- [ ] **Step 6: Run production smoke checks**

Verify public routes return 200 and repeat the cancellation-to-Card flow without a real charge. Report the synthetic order number as a test order and do not delete it unless explicitly authorised.
