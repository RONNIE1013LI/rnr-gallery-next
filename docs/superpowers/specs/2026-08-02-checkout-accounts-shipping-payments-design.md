# R&R Next Platform — Checkout, Accounts, Shipping and Payments Design

## Status

Approved in principle on 2 August 2026. The user confirmed Stripe for card
payments and requested completion of checkout, customer addresses, live
shipping, customer accounts, persistent orders, Afterpay and Zip Pay. This
specification turns that approved scope into isolated delivery slices.

## Objective

Complete a secure transaction path for the independent Next.js platform while
leaving `../rnr-wordpress-staging` unchanged. A customer must be able to check
out as a guest or signed-in user, obtain a real destination-based shipping
quote, create a persistent order and pay through an enabled provider. The
server, not browser storage, remains authoritative for prices, GST, shipping,
payment state and order state.

## Delivery Slices

### Slice 3A — persistence and customer accounts

- PostgreSQL with source-controlled Drizzle schema and SQL migrations.
- Better Auth email/password accounts and database-backed sessions.
- Guest checkout remains available; registration is not required to buy.
- Signed-in customers can save, edit and delete New Zealand and Australian
  addresses.
- Account routes expose only the signed-in customer's addresses and orders.

### Slice 3B — address, shipping and checkout

- One country-aware checkout address form shared by New Zealand and Australia.
- Server-side validation and normalization of country, street, suburb,
  city/region, postcode, phone and email.
- A provider-neutral address-suggestion interface. It remains disabled until an
  approved address provider and credentials are configured; manual entry stays
  fully functional.
- A server-owned package registry for every product and size.
- GoSweetSpot Shipping Options adapter for live rates.
- Pickup at NZ$0 and Post with a positive provider quote only.
- Persistent checkout sessions and immutable order snapshots.

### Slice 4 — payment adapters

- Stripe PaymentIntents for cards.
- Afterpay redirect checkout and capture.
- Zip web checkout and charge.
- Signed, idempotent provider callbacks and reconciliation.
- Local test adapters when provider sandbox credentials are absent.

The slices are implemented and verified in this order. Payment work does not
begin until authoritative order totals and shipping quotes are persistent.

## Technical Architecture

### Database

PostgreSQL is the durable store. Drizzle schema is the code source of truth and
generated SQL migrations are committed. Production startup never mutates the
schema automatically.

Core application tables:

- `customer_addresses`: owner, full name, company/building, street, suburb,
  city/region, postcode, country, phone and timestamps.
- `checkout_sessions`: opaque ID, optional customer ID, server-requoted cart,
  selected address, selected shipping quote, expiry and version.
- `shipping_quotes`: provider, service code/name, gross amount, currency,
  provider quote reference, request digest, expiry and raw-response audit hash.
- `orders`: public order number, optional customer ID, customer email, currency,
  product subtotal ex GST, GST, shipping, total, payment status, fulfilment
  status and timestamps.
- `order_items`: immutable configuration, price lines, private upload
  references and quantity snapshots.
- `order_addresses`: immutable billing and delivery snapshots.
- `payment_attempts`: order, provider, provider reference, idempotency key,
  expected amount, status and timestamps.
- `webhook_events`: provider event ID, payload hash, processing result and
  processed time with a unique provider/event constraint.

Better Auth owns its documented user, account, session and verification tables.
Application code references its user ID without duplicating password or session
logic.

### Repository boundaries

Domain code depends on interfaces:

- `CustomerRepository`
- `AddressRepository`
- `CheckoutRepository`
- `OrderRepository`
- `ShippingQuoteProvider`
- `PaymentProvider`

Drizzle and external provider implementations stay in `src/server`. React
components never import database clients, provider SDKs or secrets.

## Authentication and Accounts

Better Auth supplies email/password registration, secure password hashing,
database sessions, sign-out and password-change behavior. Authentication and
authorization are checked on the server for every account read or mutation.
Cookie presence alone is never treated as authorization.

Initial account pages:

- `/account/sign-in`
- `/account/register`
- `/account`
- `/account/addresses`
- `/account/orders`
- `/account/orders/[orderNumber]`

Guest orders remain associated with their checkout email but are not silently
attached to a newly created account. A later verified claim flow may attach a
guest order; matching an email string alone is insufficient authorization.

## Address Model and UX

The checkout form uses these fields:

- Full name
- Country, limited to New Zealand and Australia for the first release
- Building/company, optional
- Street
- Suburb
- City/region or Australian state/territory
- Four-digit postcode
- Phone
- Email

Billing and delivery address use the same component and country-aware validation
schema.
“Ship to a different address” reveals a second instance without introducing a
different layout or field model. Saved addresses can prefill either instance.

Country selection controls validation and constrains address suggestions to the
selected country. New Zealand requires a four-digit postcode and New Zealand
phone normalization. Australia requires a four-digit postcode, Australian
phone normalization and one of `NSW`, `VIC`, `QLD`, `WA`, `SA`, `TAS`, `ACT`
or `NT`. Switching country clears or revalidates dependent suggestion, state
and postcode values so a mixed-country address cannot be submitted.

Address suggestions are advisory only. Selecting a suggestion populates the
structured fields for its country, after which the customer can edit them. The
server still validates the submitted fields. No browser API key or complete
provider response is stored in an order. Manual entry remains fully functional
for both countries when the suggestion adapter is disabled or unavailable.

## Package Registry

Package data is selected only from server-validated `productKey + sizeKey`.
Browser-supplied dimensions and weights are ignored.

Confirmed profiles copied as business facts from the existing local audit:

- Canvas A4: 22 × 30 × 3 cm, 0.5 kg
- Canvas A3: 30 × 43 × 3 cm, 1 kg
- Canvas A2: 43 × 60 × 3 cm, 1 kg
- Canvas A1: 60 × 85 × 3 cm, 2 kg
- Canvas A0: 120 × 85 × 3 cm, 3 kg
- Roll-Up Banner: 90 × 11 × 11 cm, 3 kg
- Wall/Digital Banner 160 × 80 and 200 × 100: 104 × 6 × 6 cm, 1 kg
- Wall/Digital Banner 300 × 150: 155 × 6 × 6 cm, 3 kg
- Grave Cover: 104 × 6 × 6 cm, 1 kg

Unknown profiles fail closed and produce no Post rate.

## Live Shipping

GoSweetSpot Shipping Options is the first `ShippingQuoteProvider`. The server
sends total package weight, authoritative cart value and the complete
destination. The request body is signed with the configured HMAC secret. The
app ID and secret remain server-only environment variables.

Rules:

1. Pickup returns an explicit NZ$0 pickup option without calling a carrier.
2. Post is selectable for New Zealand or Australia only after a complete,
   country-valid address returns a positive live rate for that destination.
3. Provider timeout, malformed response, unknown package, missing credentials
   or no-rate response fails closed. It never becomes free shipping or a guessed
   flat rate.
4. Quotes have a short expiry and a request digest covering cart, quantity,
   destination and package profiles. Any relevant change invalidates the quote.
5. The checkout recalculates a fresh quote before order creation.
6. Provider GST treatment is configured only after a sandbox response is
   verified. No tax assumption is inferred from a displayed provider number.
7. Rural, residential, international and destination surcharges must come from
   the provider response.

Until GoSweetSpot sandbox credentials and account-side rules produce a valid
rate, Post remains unavailable and Pickup remains usable. Test adapters are
visibly labeled and can never run when `NODE_ENV=production`.

## Checkout and Server Repricing

The browser submits product keys, configuration choices, quantities, upload
references, address and delivery choice. It does not submit trusted totals.

The server:

1. validates every product configuration;
2. recalculates base price, options, confirmed urgent fee and GST;
3. verifies that private upload references belong to the checkout session;
4. resolves package profiles and obtains a current shipping quote;
5. creates or updates a persistent checkout session;
6. creates an immutable order in `awaiting_payment` state;
7. starts one provider payment attempt for that order and amount.

An order cannot be created with `$0` Post shipping, an expired quote, an
unconfirmed urgent fee or client-modified pricing.

## Order State

Payment status is separate from fulfilment status.

Payment states:

- `awaiting_payment`
- `processing`
- `paid`
- `failed`
- `cancelled`
- `refunded`

Fulfilment begins as `new` and cannot advance to artwork production before the
payment state is `paid`. Later artwork/revision statuses remain Phase 5.

## Payment Adapter Contract

Every provider implements:

- availability/configuration check;
- create-or-reuse payment session for one order;
- map provider state to the internal payment state;
- verify and normalize webhook/callback input;
- retrieve a payment for reconciliation;
- refund capability declaration, with implementation deferred until the order
  administration phase if not required for initial checkout.

All create calls use an order-derived idempotency key. A browser success or
return URL never marks an order paid.

### Stripe

Use one PaymentIntent per order and reuse it for retries where allowed. Amount,
currency and order ID are server supplied. The client receives only the client
secret needed by Stripe Elements. `payment_intent.succeeded` and failure events
are signature verified and processed idempotently. Sensitive customer data is
not placed in Stripe metadata.

### Afterpay

The server checks current merchant min/max order limits, creates a `/v2/checkouts`
session and stores its token. The customer is redirected to Afterpay. After the
approved return, the server captures or authorizes according to the configured
merchant flow and verifies the resulting payment before changing order state.
Sandbox and production base URLs are explicit configuration, never inferred.

### Zip

The server creates the Zip checkout and stores its checkout ID before redirect.
After customer authorization, the server creates or verifies the charge and
reconciles the provider result. Checkout creation is never called directly from
browser code.

## Webhooks, Idempotency and Recovery

- Verify provider signatures before parsing an event as trusted.
- Store provider event IDs under a uniqueness constraint before applying state
  changes.
- Ignore duplicate events after returning the provider's expected success code.
- Reject amount, currency or order-reference mismatches.
- State transitions are monotonic; an old failure event cannot overwrite a
  later confirmed payment.
- Return pages display the latest server state and can request reconciliation,
  but do not fulfil orders.
- Secrets, client secrets, tokens, complete payloads and personal details are
  never written to application logs.

## Error Handling

- Database unavailable: checkout mutation fails without creating a payment.
- Shipping unavailable: show a specific no-rate message and retain entered
  address; offer Pickup if applicable.
- Payment provider unavailable: preserve the unpaid order and allow another
  enabled method or retry.
- Redirect abandoned: order remains `awaiting_payment` and can be resumed.
- Webhook delayed: show `processing`; never report paid optimistically.
- Duplicate submission: reuse the checkout/order/payment attempt through
  idempotency keys.

## Testing and Acceptance

Automated tests cover:

- migrations and repository isolation;
- server authorization for addresses and orders;
- guest and signed-in checkout;
- server repricing and client-price tamper rejection;
- every package profile and unknown-profile failure;
- complete/incomplete New Zealand and Australian address behavior, including
  country switching and state/postcode validation;
- pickup, valid live/test Post quote, expiry, cart/address invalidation and
  no-rate failure;
- urgent fee only after explicit confirmation;
- immutable order totals and addresses;
- one payment attempt per idempotency key;
- valid, invalid and duplicate provider events;
- amount/currency mismatch rejection;
- provider failure and retry behavior.

Browser acceptance covers product → cart → New Zealand or Australian address →
shipping → payment method selection → unpaid test order at 390, 820 and
1440px. Provider sandbox payment completion is tested only when sandbox
credentials are supplied.

## Environment and Security

Required variables are documented in `.env.example` with empty values only.
Real secrets are never committed.

Logical groups:

- PostgreSQL connection
- Better Auth URL and secret
- GoSweetSpot app ID and HMAC secret
- Stripe public/secret keys and webhook secret
- Afterpay merchant credentials and environment
- Zip merchant credentials and environment
- optional address-suggestion provider credentials

Production startup validates required variables for each enabled adapter. An
adapter with incomplete credentials is disabled rather than partially active.

## Implementation Boundaries

- Do not modify or query the WordPress database at runtime.
- Do not copy GoSweetSpot credentials from WordPress.
- Do not invent carrier rates, provider tax treatment or product packages.
- Do not require account creation to complete checkout.
- Do not store card data or payment credentials.
- Do not permit a client-supplied total to reach a payment provider.
- Do not claim live shipping or payment until the corresponding sandbox and
  webhook acceptance tests have passed.

## Source References

- Stripe PaymentIntents and webhook status:
  <https://docs.stripe.com/payments/payment-intents>
- Stripe idempotent requests:
  <https://docs.stripe.com/api/idempotent_requests>
- Afterpay API quickstart:
  <https://developers.afterpay.com/afterpay-online-developer/guides/api-development/api-quickstart>
- Zip checkout creation:
  <https://developers.zip.co/v2/docs/create-a-checkout>
- GoSweetSpot Shipping Options API:
  <https://api-docs.gosweetspot.com/docs/shipping-options/introduction.html>
- Better Auth Next.js integration:
  <https://better-auth.com/docs/integrations/next>
- Drizzle migrations:
  <https://orm.drizzle.team/docs/migrations>

## Success Criteria

- Guest checkout and account checkout use the same authoritative server flow.
- Signed-in users can manage addresses and view only their own orders.
- New Zealand and Australian addresses share one layout while enforcing the
  correct country-specific rules and suggestion boundary.
- All order totals are reproduced from immutable server snapshots.
- Pickup is free; Post requires a current positive provider quote.
- A confirmed live shipping response is displayed before placing an order.
- Stripe, Afterpay and Zip share one payment contract without sharing provider
  secrets or provider-specific state in React components.
- Duplicate requests and callbacks cannot create duplicate charges or orders.
- Missing credentials fail closed with explicit test/unavailable states.
- Existing WordPress files and data remain unchanged.
