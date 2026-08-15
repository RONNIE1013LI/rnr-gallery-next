# Stripe Production Readiness Design

## Goal

Bring the existing Stripe card flow to production-ready status without making a
real charge today. The customer will perform the final real payment acceptance
tomorrow after the automated, configuration and fail-closed checks pass.

After Stripe is accepted, Afterpay production enablement remains a separate
follow-up. Zip is outside this work.

## Scope

### Production configuration

- Inspect Stripe production configuration without printing, copying or logging
  credentials.
- Confirm the publishable and secret keys use the same Stripe mode.
- Confirm the production payment return base is `https://rrgallery.co.nz`.
- Read the Stripe account's webhook endpoint configuration and confirm the
  enabled endpoint targets
  `https://rrgallery.co.nz/api/payments/webhooks/stripe`.
- Confirm the endpoint subscribes to `payment_intent.succeeded`,
  `payment_intent.processing`, `payment_intent.payment_failed`,
  `payment_intent.canceled` and `charge.refunded`. Additional Stripe events may
  be delivered but must be ignored without changing order state.

All Stripe-account operations today are read-only. No PaymentIntent, charge,
refund or customer object is created for readiness inspection.

### Fail-closed production checks

- The public Cart and checkout routes remain reachable on the production
  domain.
- The Stripe webhook route rejects missing and invalid signatures.
- A browser return cannot propose or persist a paid state.
- Incomplete or mismatched Stripe configuration disables Card rather than
  exposing a broken payment option.

### Code and automated verification

Re-run and, only where evidence exposes a gap, extend tests for:

- PaymentIntent amount, currency and order reference coming only from the
  immutable server order;
- card-only Stripe payment method configuration;
- one stable attempt and provider idempotency identity per order;
- duplicate starts, webhook replays and conflicting event hashes;
- interrupted browser recovery and identity-scoped recovery state;
- delayed provider completion and bounded reconciliation;
- paid orders resisting stale processing or failure events;
- client callbacks being unable to mark an order paid.

Any fix must be minimal and test-driven. This work does not change product
prices, GST, shipping, order snapshots, provider amount calculation, completed
orders or fulfilment status.

## Error handling

- Configuration uncertainty fails closed and does not expose Card.
- Invalid webhook traffic returns a bounded public error and makes no order or
  payment mutation.
- Stripe API inspection failures are reported without provider response bodies,
  credentials or personal data.
- If the production key is intentionally restricted from listing webhook
  endpoints, record that exact verification boundary and require dashboard
  confirmation instead of broadening key permissions.
- A delayed or ambiguous payment remains awaiting payment or processing until a
  verified webhook or authoritative reconciliation result resolves it.
- Deployment stops if any focused test, full test suite, lint, typecheck,
  database check or production build fails.

## Deployment

If code changes are required:

1. Commit only the reviewed Stripe readiness changes.
2. Build a clean release directory from the exact Git commit.
3. Compare every committed file with the release source file list.
4. Exclude unrelated local untracked files.
5. Deploy to the existing Vercel project and production aliases.
6. Confirm the deployed commit SHA, clean deployment metadata, source-file
   mapping, route health and Stripe client marker.

If no code change is required, no deployment is performed merely to create a
new release.

## Real payment acceptance

The assistant stops and explicitly asks the customer before the first action
that can create a real charge. The customer performs the payment tomorrow using
the existing production price; no artificial price change is introduced.

Acceptance requires:

1. Checkout shows Card and creates one pending-payment order.
2. Stripe Elements accepts the customer's card entry.
3. The final action displays the exact authoritative order total.
4. Stripe confirms the payment and the verified webhook is accepted once.
5. The order becomes paid and the UI shows `Order confirmed.`
6. Refreshing or reopening does not create another order or charge.
7. Cart and payment recovery state are cleared only for the paying identity.
8. No secret, client secret, card data or personal data appears in logs or the
   browser persistence audit.

The blocker is not declared fully accepted until this real-payment check is
completed. Afterward, Afterpay production readiness receives its own design and
implementation cycle.
