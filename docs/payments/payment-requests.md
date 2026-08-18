# Payment Requests and Outstanding Balances

## Purpose

Payment Requests collect one fixed amount through the existing R&R Gallery
payment providers. They do not create a hidden order and do not form a second
payment system.

Two targets are supported:

- **Order balance** — a fixed payment against an existing order.
- **Standalone** — a fixed payment that is not attached to an order.

Each request must be paid once and in full. A customer cannot edit the amount
or partially pay one request. Partial payment exists only at the Order level,
where multiple immutable ledger credits can reduce the outstanding balance.

## Data guarantees

- `payment_attempts` has exactly one database-enforced target: `order_id` or
  `payment_request_id`.
- A Payment Request stores one immutable amount and currency.
- The total of currently payable requests for an Order cannot exceed the
  current outstanding balance.
- Before a provider session is created, the server locks and recalculates the
  current ledger balance and request reservations.
- If later payments make a pending request larger than the available balance,
  reconciliation marks it `invalidated`; it cannot be paid.
- Verified online payments, bank transfers and reversals are append-only
  `payment_ledger_entries`. Existing entries are never edited in place.
- Only a bank-transfer credit can be reversed, once, with a required reason.
- A provider success is idempotently converted into one online-payment ledger
  credit.

## Security and privacy

- Public links use a 43-character random token. Only its SHA-256 digest is
  stored. Rotating a link immediately invalidates the previous token.
- `/pay/*` is noindex and excluded from the sitemap and analytics collection.
- Public APIs return allowlisted fields only; internal notes, stored contact
  details and token digests are not exposed.
- Payment administration requires `manage_payment`.
- Card requests collect name, email and optional phone only. Afterpay requests
  an address because the provider requires it. An address is not a
  universal Payment Request requirement.
- Provider sessions still use the existing Stripe and Afterpay pipelines,
  return-state protection, webhook verification and reconciliation jobs.

## Administrator workflow

### Standalone request

1. Open **Admin → Payment Requests → New payment request**.
2. Leave the type as **Standalone payment**.
3. Enter the fixed amount, currency, description and allowed methods.
4. Customer name and email are optional. An expiry and internal note are also
   optional.
5. Create the request and copy the one-time public link.

### Outstanding Order balance

1. Open the Order in Admin.
2. Review **Order payment balance** and choose **Create payment request**.
3. The Order and currency are fixed. The form defaults to the currently
   unreserved balance.
4. Enter a fixed amount no greater than the current unreserved balance and
   create the request.
5. Copy the one-time public link.

The server repeats the balance check during creation and again immediately
before starting a provider payment.

### Bank transfer and reversal

1. On the Order detail page, record the received amount, received date and any
   reference or note.
2. The credit is appended to the ledger and pending requests are reconciled.
3. To correct a bank transfer, choose **Reverse** and enter a reason. The system
   appends a debit linked to the original credit.

Do not delete or overwrite ledger records. Create a new fixed Payment Request
if a prior request becomes invalid after another payment.

## Statuses

- `pending` — may be paid if current balance and provider checks pass.
- `paid` — one verified provider payment has been credited.
- `expired` — the configured expiry has passed.
- `cancelled` — cancelled by an authorised administrator.
- `invalidated` — no longer payable because the current Order balance cannot
  cover it.

Terminal requests do not display payment controls. A rotated token is not a new
request and does not change the fixed amount.

## Public and admin routes

- Customer page: `/pay/[token]`
- Admin list: `/admin/payment-requests`
- Admin create: `/admin/payment-requests/new`
- Admin detail: `/admin/payment-requests/[requestId]`
- Public read/method/start APIs: `/api/payment-requests/[token]/*`
- Admin request APIs: `/api/admin/payment-requests/*`
- Order ledger API: `/api/admin/orders/[orderId]/ledger`

## Explicit non-goals

- No customer-entered amount.
- No `partially_paid` request status.
- No hidden Order.
- No legacy `$0.01 × quantity` workaround.
- No automatic refunds or destructive ledger edits.
