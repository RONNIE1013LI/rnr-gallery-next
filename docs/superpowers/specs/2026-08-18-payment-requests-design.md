# Custom Payment and Outstanding Balance Payment Design

## Goal

Add a production-grade Payment Request system to the R&R Gallery Next.js site. It supports fixed-amount outstanding-balance links for existing orders and fixed-amount standalone links for manually quoted work, while reusing the existing Stripe, Afterpay, payment-return, reconciliation, and webhook infrastructure.

The old `$0.01 × quantity` workaround belongs only to the legacy site. It does not exist in this repository and is not migrated, supported, or referenced by the new implementation.

## Confirmed business rules

- Every Payment Request has one immutable amount and currency and must be paid in full in one transaction.
- Customers cannot change, reduce, split, or overpay a Payment Request.
- Partial payment exists only at Order level through multiple immutable ledger entries.
- A Payment Request either belongs to an existing Order or is standalone.
- An order-linked request cannot exceed the current outstanding balance.
- The total of all still-payable requests for one Order cannot exceed the current outstanding balance.
- The server revalidates the current outstanding balance immediately before claiming a provider checkout/payment session.
- A pending request that no longer fits the current balance is permanently invalidated; staff creates a new fixed-amount request for the new balance.
- Manual bank transfers are immutable ledger credits. Corrections use a linked reversal entry rather than editing or deleting history.
- Only administrators with `manage_payment` permission can create, cancel, rotate, or record payment data.
- Public tokens are high-entropy secrets; only their SHA-256 digests are stored.
- Standalone customers provide only the contact/address fields required by the selected provider. Address is not globally mandatory.

## Chosen architecture

Extend the current payment pipeline to support a unified Payment Target:

- an existing Order; or
- a Payment Request.

Do not create hidden orders for standalone payments. Do not create a second payment engine. Provider adapters, idempotency, return-state validation, webhook verification, reconciliation, and public payment DTOs remain shared.

## Data model

### `payment_requests`

Stores the immutable collection instruction.

- `id` UUID primary key
- `request_number` unique human-readable reference used in provider metadata
- `public_token_digest` unique SHA-256 digest
- `token_rotated_at` nullable timestamp
- `kind`: `order_balance` or `standalone`
- `order_id` nullable FK to `orders`
- `customer_name` nullable internal value
- `customer_email` nullable internal value
- `description`
- `currency`: `NZD` or `AUD`
- `amount_cents` positive integer
- `enabled_payment_methods`: non-empty subset of `card`, `afterpay`
- `status`: `pending`, `paid`, `expired`, `cancelled`, or `invalidated`
- `status_reason` nullable safe internal code
- `expires_at` nullable timestamp
- `internal_note` nullable
- `created_by` FK to admin user
- `cancelled_by` nullable FK
- `cancelled_at`, `invalidated_at`, `paid_at`, `created_at`, `updated_at`

Database constraints enforce:

- `order_balance` has an `order_id`; `standalone` does not.
- amount is positive and currency is supported.
- `(id, amount_cents, currency)` is unique so payment attempts can reference the immutable request amount.
- no `partially_paid` status exists.

Expiration is enforced on every read and payment mutation. A pending row whose expiry has passed is atomically moved to `expired`; no background cron is required for correctness.

### `payment_ledger_entries`

The append-only source of truth for money received against an Order or Payment Request.

- `id` UUID primary key
- `order_id` nullable FK
- `payment_request_id` nullable FK
- `payment_attempt_id` nullable unique FK
- `entry_type`: `online_payment`, `bank_transfer`, `reversal`, `legacy_backfill`, or `refund`
- `direction`: `credit` or `debit`
- `amount_cents` positive integer
- `currency`
- `received_at`
- `reference` nullable
- `payer_name` nullable
- `note` nullable
- `reverses_entry_id` nullable unique self-FK
- `created_by` nullable FK for system/provider entries
- `created_at`

An order-linked online request entry references both its Payment Request and Order. A standalone success references only its Payment Request. A bank transfer references an Order. A reversal must reference exactly one prior reversible credit and use the same Order, amount, and currency. Existing entries are never updated or deleted.

Net paid is credits minus debits. Outstanding balance is `max(order total - net paid, 0)`. Provider refunds are not added as a new UI in this task, but the ledger can represent a future verified refund without redesign.

### `payment_attempts`

The existing table is extended rather than duplicated.

- `order_id` becomes nullable.
- `payment_request_id` is added as a nullable FK.
- `payer_snapshot` is added as nullable structured JSON for standalone provider retries/reconciliation.
- Existing provider, method, amount, currency, lease, state, status, and idempotency fields remain.

Database-level target constraints:

- exactly one of `order_id` and `payment_request_id` must be non-null;
- an Order attempt retains the composite FK to `(orders.id, total_incl_gst_cents, currency)`;
- a Payment Request attempt has a composite FK to `(payment_requests.id, amount_cents, currency)`;
- separate partial unique indexes allow at most one nonterminal attempt per Order and at most one per Payment Request.

Existing Order attempts remain valid during migration.

## Order ledger migration

The migration backfills one immutable ledger credit for each verified paid legacy attempt, guarded by the unique `payment_attempt_id` constraint. If an Order is already marked `paid` but has no paid attempt, add one `legacy_backfill` credit for the immutable Order total with a clear system reference. This preserves the current production state without inventing a provider transaction.

No historical price snapshot, completed order total, provider amount, or order number is changed.

## Balance and reservation invariants

Every mutation that affects an Order balance locks the Order row first. All services use the same lock order to avoid deadlocks.

### Creating an order-linked request

Within one transaction:

1. lock the Order;
2. expire stale requests;
3. calculate net paid and outstanding balance from the ledger;
4. reconcile pending reservations;
5. sum all still-payable Payment Requests;
6. reject zero, negative, over-balance, currency-mismatched, cancelled/refunded, or over-reserved input;
7. insert the immutable request and token digest.

Concurrent admin requests serialize on the Order lock, so two requests cannot jointly reserve more than the current outstanding balance.

### Revalidating before provider session creation

For an order-linked request, the server locks the Order and Payment Request, recalculates ledger balance, verifies expiry/status/method/currency, and confirms the fixed request still fits the balance before claiming the nonterminal attempt lease. The provider receives only the stored amount and currency.

Once an attempt lease or nonterminal provider attempt exists, its amount remains reserved. A bank-transfer mutation that would conflict with an in-flight provider payment is rejected with an actionable admin message until that attempt is reconciled or safely cancelled. This prevents a provider session that is already capable of charging from becoming an overpayment race.

### Balance changes after request creation

After any new Order credit or reversal, pending requests without an in-flight attempt are reconciled deterministically in creation order. Requests that individually exceed the new balance or no longer fit within the remaining reservation capacity are moved to terminal `invalidated` status with reason `outstanding_balance_reduced`. They never become payable again automatically.

The request whose verified online payment produced the credit is marked `paid` before remaining reservations are reconciled.

## Payment pipeline

The provider-neutral `PaymentOrder` concept becomes a `PaymentTargetSnapshot` with:

- target kind and ID;
- stable merchant reference (`order_number` for Orders, `request_number` for Payment Requests);
- authoritative amount and currency;
- provider-required customer/address data;
- optional linked Order number for display only.

Provider adapters continue to create a single payment for the exact target amount. Stripe PaymentIntent has no quantity model; its `amount` is the fixed request amount. Afterpay receives the same fixed amount and stable merchant reference. No adapter constructs a cent-priced high-quantity item.

Provider availability is the intersection of:

- methods selected by the administrator;
- current production provider configuration;
- provider currency/country limits;
- presence of the provider-specific payer fields.

For existing-order requests, the immutable Order customer and address snapshots are used. For standalone requests:

- Card does not require a site-level address; Stripe Elements remains responsible for card collection.
- Afterpay requires full name, email, phone, and one normalized address; the payment-only flow uses that address for both provider billing and shipping fields.

Public input can supply only payer/contact fields and an idempotency key. It cannot supply amount, currency, request ID, merchant reference, description, or enabled methods.

## Verified result handling and idempotency

The existing provider reference, return-state, webhook-event, and idempotency checks remain. Verified result application is extended so one database transaction:

1. locks the attempt and its one target;
2. verifies provider reference, merchant reference, fixed amount, currency, and target identity;
3. applies the attempt state transition;
4. inserts at most one ledger entry using unique `payment_attempt_id`;
5. marks the Payment Request `paid` when applicable;
6. recalculates the linked Order payment status from ledger balance;
7. reconciles remaining request reservations;
8. enqueues existing notifications only after the Order becomes fully paid.

Duplicate webhooks/returns/reconciliation runs do not create another ledger entry or change a paid request back to a payable state.

Stripe verified webhooks continue through the existing webhook route. Afterpay continues through its current verified return and reconciliation path. The repository dispatches by the stored attempt target, not by trusting a client-supplied target type.

## Status rules

### Payment Request

- `pending` can move to `paid`, `expired`, `cancelled`, or `invalidated`.
- terminal states never return to `pending`.
- provider attempt status remains separate, so an in-progress provider flow does not require a `partially_paid` request status.
- paid, expired, cancelled, invalidated, or already-in-progress requests cannot start a new session.

### Order

- `paid` when outstanding balance is zero.
- `processing` while a verified nonterminal payment is in progress and balance remains.
- `awaiting_payment` when balance remains and no provider payment is in progress.
- existing cancelled/refunded terminal handling remains protected.

A failed individual attempt remains visible in history but does not make a partially paid Order permanently unpayable.

## Token lifecycle

- Generate at least 32 random bytes and encode them URL-safely.
- Store only `SHA-256(token)` with a unique index.
- Return the raw token only in the successful create/rotate response.
- Admin can copy the link immediately.
- Later rotation is allowed only for a pending request with no nonterminal attempt; it replaces the digest and invalidates the prior URL immediately.
- Admin lists never expose token digests.
- Public lookup uses constant-format hashing and exact digest lookup and returns the same 404 shape for invalid/unknown tokens.

## Admin UX and permissions

### Existing Order detail

Add a Payment summary showing:

- immutable Order total;
- net paid;
- outstanding balance;
- active reserved request total;
- payment ledger/history.

Add `Record bank transfer` and `Create payment request` forms. The request amount defaults to the currently available unreserved balance, description defaults to `Outstanding Balance - Order #<number>`, currency is inherited and read-only, and enabled methods reflect configured capability. Creation returns a one-time copyable link.

Bank transfer fields are amount, received date, reference/note, and optional payer name. A separate reversal action requires a reason and confirmation.

### Standalone requests

Add:

- `/admin/payment-requests`
- `/admin/payment-requests/new`
- `/admin/payment-requests/[requestId]`

The create form accepts optional internal customer name/email, description, fixed amount, NZD/AUD currency, enabled methods, optional expiry, and internal note. The detail page shows safe status/history and permits copy-on-create, token rotation, or cancellation when state allows.

All mutation routes require an authenticated administrator with `manage_payment`, trusted-origin mutation validation, bounded strict input schemas, and idempotency keys. Staff without that permission can neither view sensitive standalone details nor mutate payments.

## Public UX

Add `/pay/[token]` with `noindex`, `noarchive`, no sitemap entry, no prefetch from public catalogues, `Cache-Control: no-store`, and no analytics collection. The page shows only:

- R&R Gallery branding;
- Payment Request or Outstanding Balance title;
- safe request reference;
- linked Order number when present;
- description;
- immutable amount and currency;
- status and available methods.

It never displays admin internal notes, stored customer email/name, ledger references, provider references, token digests, or Order addresses.

Pending standalone requests show only the fields needed for the selected provider. Terminal or invalid tokens render clear paid/expired/cancelled/invalidated/not-found states and no payment controls.

Provider cancel/return navigation returns to the same protected payment page while the raw public token remains browser-held. Rotation is disallowed during a nonterminal attempt, so an in-flight return cannot be orphaned. The route is added to the existing GA private-route policy so neither the token nor payer data is sent to analytics.

## API and service surface

Expected additions:

- payment-request domain validation and status transition module;
- payment ledger/balance service;
- Drizzle payment-request repository;
- unified payment-target loading in the existing payment repository/service;
- admin Payment Request and bank-transfer mutation routes/actions;
- public Payment Request details/methods/start endpoints;
- Admin pages/components listed above;
- public `/pay/[token]` page;
- one Drizzle migration following the current migration sequence.

Existing `/api/orders/[orderNumber]/payment`, provider return routes, Stripe webhook route, reconciliation route, checkout payment UI, and normal Order payment path remain supported.

## Security and privacy

- Amount, currency, target, methods, status, expiry, and merchant reference are loaded from the database on every start.
- Public payloads cannot override financial fields.
- Public errors do not reveal whether a token shape is valid or whether an internal customer exists.
- Payer snapshots are returned only to finance-authorized admin code and provider adapters.
- No customer name, email, phone, address, request description, token, provider reference, or ledger note enters analytics/dataLayer.
- `/pay/*` is treated as a private analytics route because the token is in the path.
- Admin/customer DTOs are explicit allowlists rather than table-row spreads.
- Raw provider payloads are not newly persisted; existing verified safe provider identifiers and normalized statuses remain sufficient.

## Testing

### Unit

- fixed positive integer-cent validation;
- no request-level partial status;
- XOR payment target constraint contract;
- request/status transitions and expiry;
- ledger net-paid/outstanding calculation;
- reversal validation;
- aggregate reservation validation;
- provider-specific payer requirements;
- public DTO and analytics PII allowlists.

### Database/service integration

- concurrent order-linked request creation cannot over-reserve;
- bank transfer plus fixed request reaches fully paid Order;
- multiple fixed requests fit but never exceed balance;
- provider preflight rechecks current balance;
- balance reduction invalidates pending requests deterministically;
- conflicting in-flight provider reservation blocks bank-transfer overpayment;
- verified provider result inserts one ledger credit exactly once;
- duplicate webhook/return/reconciliation remains idempotent;
- standalone request pays without an Order;
- invalid, rotated, expired, cancelled, invalidated, and paid tokens cannot start payment;
- paid request cannot be repaid;
- existing Order payment behavior and historical backfill remain valid.

### Routes/components/E2E

- finance-authorized Admin creates an Order request and copies its link;
- finance-authorized Admin records and reverses a bank transfer;
- finance-authorized Admin creates a standalone request;
- unauthorized staff/public access is rejected;
- public page shows fixed amount and correct NZD/AUD formatting;
- Card flow requires no site address;
- Afterpay requests only its required payer fields;
- client amount tampering has no effect;
- public token route is noindex and excluded from GA;
- mobile and desktop payment pages remain usable;
- one Playwright path covers admin creation to public page access without performing a real charge.

Run focused tests after each slice, then TypeScript, ESLint, the complete test suite with the isolated test database, production build, and Playwright smoke checks. Real-money payment is not required for this implementation verification.

## Out of scope

- WordPress changes or legacy workaround migration
- hidden/fake Orders for standalone requests
- customer-chosen partial amount
- editing immutable request amount/currency after creation
- provider refund UI or new refund promises
- invoice/tax recalculation for standalone collections
- changing completed Order totals, product pricing, shipping, or provider amount calculation
- Google/analytics enablement changes beyond protecting `/pay/*`

## Release boundary

Implementation remains on `feat/payment-requests` in its own worktree. No production deployment occurs until migration, tests, build, and public/admin security checks pass and the release artifact is explicitly approved for deployment.

The live provider credentials and production payment configuration are not used during implementation tests. A previously successful real payment proves only the existing provider account path; it does not replace fixed-request amount, target isolation, ledger idempotency, or balance-race regression tests.
