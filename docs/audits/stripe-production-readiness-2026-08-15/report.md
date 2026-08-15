# Stripe Production Readiness — 2026-08-15

## Outcome

- **BLOCKED FOR CUSTOMER REAL-PAYMENT TEST**
- Application code and fail-closed production routes pass the current automated checks.
- Production still exposes a Stripe test-mode publishable key.
- The Stripe live-mode Dashboard does not contain a webhook endpoint for
  `https://rrgallery.co.nz/api/payments/webhooks/stripe`.
- No PaymentIntent, charge, refund or Stripe customer was created during this
  audit.

## Code corrections

- Stripe configuration now fails closed for malformed server, publishable or
  webhook-secret shapes.
- Stripe configuration now fails closed when server and publishable key modes
  differ.
- Standard and restricted Stripe server-key prefixes are accepted only when
  they match the publishable key's test/live mode.
- Stripe PaymentIntent creation is explicitly Card-only through
  `payment_method_types: ["card"]`.
- Link and automatic payment methods are not enabled.
- Order amount, currency, order reference, idempotency and payment-state logic
  were not changed.

## Configuration

- Vercel Stripe variable names exist: PASS
- Vercel Sensitive values are non-exportable placeholders: EXPECTED
- Server key mode: NOT DIRECTLY OBSERVABLE FROM VERCEL
- Production publishable key mode observed in the deployed checkout bundle:
  **test**
- Production live-payment key mode requirement: **FAIL**
- Production return origin: NOT DIRECTLY EXPORTABLE; route-origin probes pass
- Reconciliation secret configured: PASS
- Stripe Dashboard mode inspected: live
- Required live webhook endpoint: **FAIL — endpoint absent**
- Required live webhook event subscriptions: NOT APPLICABLE UNTIL ENDPOINT EXISTS
- Existing live endpoints target the legacy `rnrgallery.com` WordPress site;
  they were not modified.
- Current Stripe credential records target both Production and Preview in
  Vercel. Before inserting live credentials, production live secrets must be
  scoped to Production only: **REQUIRES CONFIGURATION CHANGE**

## Fail-closed production probes

- `GET /cart`: PASS — HTTP 200
- `GET /checkout`: PASS — HTTP 200
- Missing Stripe webhook signature: PASS — HTTP 400 `INVALID_WEBHOOK`
- Invalid Stripe webhook signature: PASS — HTTP 400 `INVALID_WEBHOOK`
- Malformed Stripe browser return: PASS — HTTP 404
  `PAYMENT_RETURN_NOT_FOUND`
- Reconciliation without bearer authority: PASS — HTTP 401 `UNAUTHORIZED`

These probes used invalid or unauthenticated inputs and made no payment or order
mutation.

## Automated verification

- Initial isolated-database baseline: PASS — 245 files passed, 3 skipped; 1575
  tests passed, 5 skipped; 0 failed.
- Stripe/payment focused suite: PASS — 9 files, 279 tests.
- Full isolated-database suite after corrections: PASS — 245 files passed, 3
  skipped; 1584 tests passed, 5 skipped; 0 failed.
- TypeScript: PASS
- ESLint: PASS
- Drizzle schema check: PASS
- Production build with validation-only Stripe credentials: PASS

## Deployment

- The release is generated from the exact immutable commit containing this
  report. The resulting deployment ID, deployed SHA, source-file comparison and
  route-health results are recorded in the task handoff because a deployment ID
  cannot be known inside the commit that creates that deployment.

## Required configuration before real payment

1. Add production-only Stripe live secret and publishable keys to Vercel.
2. Add the live Stripe webhook signing secret to Vercel Production only.
3. Create and enable the live Stripe webhook endpoint:
   `https://rrgallery.co.nz/api/payments/webhooks/stripe`.
4. Subscribe it to:
   - `payment_intent.succeeded`
   - `payment_intent.processing`
   - `payment_intent.payment_failed`
   - `payment_intent.canceled`
   - `charge.refunded`
5. Redeploy and confirm the public checkout bundle uses `pk_live_`.
6. Repeat the invalid-signature and route-health probes.

## Remaining manual acceptance

- One customer-operated real card payment tomorrow.
- The customer must enter the card details; the assistant will not view or
  handle them.
- Acceptance requires one order, one payment attempt, one accepted verified
  webhook, exact immutable amount/currency, `Order confirmed.` UI, no duplicate
  charge after refresh, and identity-scoped Cart/recovery cleanup.
