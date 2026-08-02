# Checkout, Shipping and Persistent Orders — Implementation Plan

## Goal

Build the authoritative checkout boundary for the independent Next.js platform.
The server must reprice every cart, validate upload ownership, quote Pickup or
Post, and persist one immutable unpaid order before any payment provider starts.
The WordPress project remains untouched.

## Success criteria

- Guest and signed-in customers can check out with NZ or AU addresses.
- Browser-supplied labels, prices, GST and urgent fees are ignored.
- Urgent fees are included only after explicit confirmation and are recalculated
  from the Auckland business date.
- Pickup is exactly NZ$0; Post exists only with a current positive provider quote.
- Uploads can only be used by the checkout session that created them.
- Repeated order submissions create one order.
- Orders, items and addresses are immutable server snapshots.
- Manual address entry always works; suggestions remain safely disabled until a
  provider is configured.

## Task 1 — Canonical checkout input and server repricing

Files:

- Create `src/domain/checkout/types.ts`
- Create `src/domain/checkout/input-schema.ts`
- Create `src/domain/checkout/reprice-cart.ts`
- Create `src/domain/checkout/reprice-cart.test.ts`

Steps:

1. Write failing tests for tampered client prices/titles/urgent cents, invalid
   configurations, quantity bounds, and all urgent-fee tiers.
2. Accept only canonical product/configuration selections and upload IDs.
3. Resolve product/size labels and price lines from existing registries.
4. Recalculate GST and urgent service using the Auckland order date.
5. Reject a fee-bearing needed date unless urgent confirmation is exactly true.
6. Return a stable cart digest and immutable repriced item snapshots.
7. Run focused tests, lint and typecheck; commit.

## Task 2 — Package registry and shipping provider boundary

Files:

- Create `src/server/shipping/types.ts`
- Create `src/server/shipping/package-registry.ts`
- Create `src/server/shipping/package-registry.test.ts`
- Create `src/server/shipping/local-test-provider.ts`
- Create `src/server/shipping/local-test-provider.test.ts`
- Create `src/server/shipping/gosweetspot-provider.ts`
- Create `src/server/shipping/gosweetspot-provider.test.ts`
- Create `src/server/address-suggestions/types.ts`
- Create `src/server/address-suggestions/disabled-provider.ts`
- Update `.env.example`

Steps:

1. Write failing coverage for every confirmed product/size profile and unknown
   profile failure.
2. Define provider-neutral quote/request contracts with explicit gross and GST.
3. Add a deterministic development-only provider labeled as a test rate; throw
   when production attempts to enable it.
4. Add the GoSweetSpot adapter using the exact JSON body and SHA-256 HMAC over
   those exact bytes, an abort timeout, schema validation and positive-rate checks.
5. Require an explicit `incl_gst` or `ex_gst` configuration; missing or invalid
   tax mode makes the provider unavailable.
6. Keep address suggestions disabled behind the provider-neutral interface.
7. Run focused tests, lint and typecheck; commit.

## Task 3 — Checkout, upload, quote and order schema

Files:

- Create `src/server/db/schema/checkout.ts`
- Create `src/server/db/schema/uploads.ts`
- Create `src/server/db/schema/orders.ts`
- Update `src/server/db/schema/index.ts`
- Generate `drizzle/0002_*.sql`
- Create schema/migration integration tests as needed

Steps:

1. Write schema assertions for ownership, unique idempotency and immutable money
   columns.
2. Add checkout sessions, checkout uploads, shipping quotes, orders, order items
   and order addresses.
3. Store a digest of the opaque guest token, never the raw token.
4. Store product/shipping ex-GST, GST and gross amounts explicitly.
5. Add foreign keys and uniqueness preventing partial or duplicate orders.
6. Generate and apply the migration to a disposable PostgreSQL database.
7. Run DB checks, focused tests and typecheck; commit.

## Task 4 — Checkout session and upload ownership

Files:

- Create `src/server/checkout/session-cookie.ts`
- Create `src/server/checkout/session-cookie.test.ts`
- Create `src/server/checkout/checkout-repository.ts`
- Create `src/server/checkout/drizzle-checkout-repository.ts`
- Create repository integration tests
- Create `src/server/auth/get-optional-session.ts`
- Create `src/server/http/multipart-mutation-request.ts`
- Modify `src/app/api/uploads/route.ts`
- Modify `src/server/uploads/local-private-upload-store.ts`
- Update upload tests

Steps:

1. Write failing tests for random HttpOnly SameSite=Lax cookies, production
   Secure behavior, token hashing and owner isolation.
2. Ensure/create a checkout session before accepting an upload.
3. Enforce trusted same-origin multipart requests.
4. Persist safe upload metadata against the session.
5. Delete the just-written file if metadata insertion fails.
6. Reject unowned and cross-session upload references.
7. Preserve the explicit send-after-ordering flow without upload references.
8. Run focused tests, integration tests, lint and typecheck; commit.

## Task 5 — Shipping quote service and APIs

Files:

- Create `src/server/shipping/shipping-service.ts`
- Create `src/server/shipping/shipping-service.test.ts`
- Create `src/server/checkout/checkout-service.ts`
- Create `src/server/checkout/checkout-service.test.ts`
- Create `src/app/api/checkout/session/route.ts`
- Create `src/app/api/checkout/session/route.test.ts`
- Create `src/app/api/checkout/shipping/route.ts`
- Create `src/app/api/checkout/shipping/route.test.ts`

Steps:

1. Write failing tests for NZ/AU normalization, Pickup NZ$0, positive Post only,
   expiry and cart/address/package invalidation.
2. Persist a versioned authoritative cart snapshot.
3. Build package requests only from the server registry.
4. Persist quotes with a digest and short expiry.
5. Return Pickup and available Post options with visible test/live provenance.
6. Never turn provider failure into free or guessed shipping.
7. Run focused tests, integration tests, lint and typecheck; commit.

## Task 6 — Atomic order creation

Files:

- Create `src/server/orders/order-repository.ts`
- Create `src/server/orders/drizzle-order-repository.ts`
- Create repository integration tests
- Create `src/server/orders/order-service.ts`
- Create `src/server/orders/order-service.test.ts`
- Create `src/app/api/checkout/order/route.ts`
- Create `src/app/api/checkout/order/route.test.ts`

Steps:

1. Write failing tests for duplicate idempotency keys, expired Post quotes,
   changed carts/addresses, partial DB failure and cross-owner access.
2. Revalidate/reprice the cart and obtain a fresh Post quote before the DB
   transaction.
3. Within one transaction, verify unchanged session version/digest and insert
   immutable order, items, addresses and claimed uploads.
4. Return the existing order for a repeated idempotent request.
5. Return only the payment-start DTO needed by the next slice.
6. Run focused tests, integration tests, lint and typecheck; commit.

## Task 7 — Checkout UI

Files:

- Create `src/app/checkout/page.tsx`
- Create `src/components/checkout-view.tsx`
- Create `src/components/checkout-view.test.tsx`
- Create `src/components/checkout-order-summary.tsx`
- Add scoped checkout rules to `src/components/storefront.module.css`

Steps:

1. Write failing component tests for manual NZ/AU entry, saved-address prefill,
   same-layout delivery address, shipping selection, totals and submission states.
2. Reuse `AddressForm` for billing and optional delivery address.
3. Show Pickup and current Post options with clear test/live status.
4. Render all labels left and values right without narrow-column wrapping.
5. Create the order with a stable client idempotency key and navigate to its
   confirmation page.
6. Verify keyboard, focus, validation and 44px minimum targets.
7. Run component tests, lint and typecheck; commit.

## Task 8 — Order confirmation and account order history

Files:

- Create `src/app/orders/[orderNumber]/page.tsx`
- Create `src/app/account/orders/page.tsx`
- Create `src/app/account/orders/[orderNumber]/page.tsx`
- Create owner-scoped order query functions and tests
- Update account navigation where necessary

Steps:

1. Write failing authorization tests: another guest/customer cannot read an
   order by guessing its number.
2. Authorize guest confirmation through the checkout session cookie.
3. Authorize account history only through the current Better Auth user ID.
4. Display immutable order totals and `awaiting_payment` state.
5. Run focused tests, lint and typecheck; commit.

## Task 9 — Integrated verification

1. Apply migrations to a disposable PostgreSQL database.
2. Run `npm run test:run`, `npm run lint`, `npm run typecheck`,
   `npm run db:check`, `npm run build`, and `git diff --check`.
3. In a real browser at 390, 820 and 1440px, verify guest and signed-in checkout,
   NZ and AU addresses, upload ownership, Pickup, test Post, urgent confirmation,
   duplicate submission and order authorization.
4. Confirm no horizontal overflow, overlap, clipped controls or console errors.
5. Confirm the WordPress repository has not changed.
6. Request final code review and resolve only evidence-backed findings.

## Explicitly deferred to Slice 4

- Stripe PaymentIntents
- Afterpay redirect/capture
- Zip Pay checkout/charge
- Payment attempts, webhooks and reconciliation

These adapters will consume only the persisted payment-start DTO from Task 6.
