# Internal Notification Center and Market Switching Design

## Goal

Deliver two related operational improvements without changing customer-facing email behavior:

1. make New Zealand/Australia market switching reliable, explicit, and responsive when the current cart must be repriced; and
2. give administrators one place to manage arbitrary verified email recipients for five internal business notifications.

This is an additive change. Existing customer emails, customer recipients, payment authorization, checkout totals, order records, and production data remain authoritative and unchanged.

## Confirmed business rules

### Internal notifications

- Only administrators can view or manage internal notification recipients. Staff cannot view the page or call its APIs.
- A recipient can be any syntactically valid email address. It does not need to belong to a website account.
- Email addresses are trimmed, lowercased, and unique after normalization.
- A new or re-enabled email must verify ownership before receiving notifications.
- Each verified recipient independently subscribes to one or more of five topics:
  - `manual_order_created`
  - `web_order_paid`
  - `payment_request_paid` (standalone Payment Requests only)
  - `proof_approved`
  - `proof_changes_requested`
- Website order notifications are created only after payment first reaches the verified paid state.
- Customer-facing emails and their recipients are out of scope and must not change.
- A topic may have zero active recipients. Business operations continue, while the Admin page displays a prominent warning for that topic.
- Admin "Delete" is a soft disable. It immediately prevents new delivery and cancels queued, unsent internal notifications for the recipient. Sent history remains.
- Re-adding a disabled address requires a new verification and an explicitly selected subscription set.

### Market switching

- A market change must authoritatively reprice the current cart before the market cookie or stored cart changes.
- The UI must never silently ignore a failed switch.
- If one or more cart items require urgent-service confirmation in the target market, the user must see the affected items and target-market fee before choosing what to do.
- The user may confirm the additional urgent service, change affected completion dates, or cancel the market switch.
- No item may be deleted, no date may be changed, and no additional fee may be accepted automatically.
- A successful switch performs one client navigation, not a navigation followed by a duplicate refresh.

## Current-state findings

### Market switch failure

`src/components/market-selector.tsx` posts the active cart to `/api/market`. The API correctly uses the current product registry and `repriceCart` for the target market. When target-market pricing requires urgent confirmation, the API returns `409`, but the client returns without showing the response error. The select then appears to revert to the original market.

After a successful response, the component currently calls both `router.push(...)` and `router.refresh()`. This duplicates work on dynamic home pages and makes an otherwise successful switch feel slower.

The approved repair preserves authoritative server repricing and makes the recoverable urgent-confirmation case explicit. It does not replace the homepage data-loading architecture.

### Existing notification paths

The repository already uses Resend and durable outboxes for customer proof, order, and payment-request email. Internal website-order and payment-request alerts currently derive recipients from every user whose role is `admin`. Manual-order creation has no equivalent internal notification.

The new internal notification center replaces recipient selection for new internal events only. Existing customer outboxes and customer templates remain intact. Pre-deployment internal rows already queued in legacy outboxes remain deliverable to their recorded recipient snapshots; they are not migrated or duplicated.

## Chosen architecture

Use one unified internal notification subsystem with:

- a normalized, verified recipient registry;
- per-recipient topic subscriptions;
- a durable, recipient-expanded internal outbox;
- an Admin-only management page;
- a public, opaque-token verification flow; and
- integration points at the five committed business events.

This avoids duplicating recipient management across the existing order, payment-request, and proof outboxes. It also keeps customer and internal delivery policies separated.

Rejected alternatives:

- Modifying each existing outbox independently would duplicate verification, subscription, audit, and disable behavior.
- Storing recipient configuration as one JSON document would weaken uniqueness, concurrency, auditability, and queued-message cancellation.

## Data model

### `internal_notification_recipients`

One row represents one normalized email identity.

- `id`: UUID primary key
- `email`: normalized email, unique
- `status`: `pending_verification`, `active`, or `disabled`
- `verification_token_digest`: nullable unique SHA-256 digest
- `verification_expires_at`: nullable timestamp
- `verification_issued_at`: nullable timestamp
- `verified_at`: nullable timestamp
- `created_by_user_id`: Admin user ID
- `disabled_by_user_id`: nullable Admin user ID
- `disabled_at`: nullable timestamp
- `created_at`, `updated_at`

Database checks require:

- a pending row to have issued, digest, and expiry values, with expiry later than issuance;
- an active row to have `verified_at` and no usable verification token;
- a disabled row to have `disabled_at`; and
- a trimmed, lowercased, non-empty email value.

The service, rather than a time-dependent database check, compares `verification_expires_at` with the current time when a token is consumed.

Only a digest is stored. The raw verification token is returned once to the email composition path and is never logged, audited, or returned by Admin list APIs.

### `internal_notification_subscriptions`

Rows express enabled topics; absence means not subscribed.

- `recipient_id`: FK to `internal_notification_recipients`
- `topic`: one of the five fixed internal topics
- `created_at`, `updated_at`
- composite primary or unique key on `(recipient_id, topic)`

Pending recipients may have saved subscriptions, but only `active` recipients are eligible for enqueue or delivery. Re-enabling a disabled address replaces its old subscription set with the Admin's new selection.

### `internal_notification_outbox`

One row represents one event-recipient delivery.

- `id`: UUID primary key
- `event_key`: unique `<topic>:<source-event-id>:<recipient-id>` value
- `topic`: one of the five fixed topics
- `source_event_id`: immutable UUID production-job, order, payment-request, or proof-review event identity
- `resource_type`: `production_job`, `order`, `payment_request`, or `proof_review`
- `resource_id`: authoritative UUID internal resource ID; the polymorphic reference is validated by the event producer rather than a cross-table foreign key
- `resource_reference`: safe display reference such as job, order, or request number
- `recipient_id`: FK to the recipient row
- `recipient_email`: immutable normalized delivery snapshot
- `payload`: minimal versioned JSON needed to render the internal message
- `status`: `pending`, `sending`, `sent`, `failed`, or `cancelled`
- `attempts`, `available_at`, `last_attempt_at`
- `sent_at`, `provider_message_id`, `last_error_code`
- `cancelled_at`, `cancellation_reason`
- `created_at`, `updated_at`

The payload contains only safe operational summary fields. It does not contain verification tokens, payment credentials, full addresses, proof files, customer messages, or raw provider payloads.

The unique event key makes repeated webhook handling, retries, and service restarts idempotent per recipient.

## Recipient lifecycle and verification

### Add

An Admin enters an email and selects one or more topics. The service normalizes the email, rejects an empty topic set and an existing pending or active duplicate, creates a pending recipient, replaces its subscription set, and issues at least 32 random bytes encoded as a URL-safe token. Only its SHA-256 digest is stored, with a 24-hour expiry.

A previously disabled email reuses its existing identity row but begins a new pending-verification lifecycle. Its prior subscriptions are replaced, its disabled fields are cleared, and a new token invalidates all older tokens.

### Verification delivery

The verification email is sent through the existing Resend provider after the pending database state commits. A provider failure does not remove the pending row. The API reports that the recipient was saved but delivery failed, and the Admin UI offers `Resend verification`.

Resending generates a new token and invalidates the previous digest before attempting delivery. Automated tests use a fake provider and never send real email.

### Verify

The opaque link opens a `noindex`, `noarchive`, no-store verification page. A GET only displays a confirmation screen; it does not consume the token, which prevents email-security link scanners from activating recipients. A POST hashes the token, locks the matching pending row, verifies the 24-hour expiry, atomically marks the row active, clears the token fields, and records `verified_at`.

Expired, unknown, already-used, or disabled tokens return the same safe invalid-link state. The page does not require an Admin session because possession of the single-use token proves access to the mailbox.

### Update subscriptions

An Admin can replace the topic set for a pending or active recipient. The replacement is transactional and idempotent. Subscription changes affect future events only; already-created outbox rows retain their original recipient snapshot unless the recipient is disabled.

### Disable

The Admin UI labels this operation `Delete`. In one transaction the service:

1. locks the recipient;
2. marks it `disabled` and records the actor and time;
3. marks its `pending` and `failed` internal outbox rows `cancelled`; and
4. invalidates any outstanding verification token.

The delivery service rechecks that the recipient is active immediately before sending a claimed row. It cancels a row when the recipient is no longer active. A provider request that has already completed cannot be recalled, so sent history remains immutable.

No disable operation touches customer notification outboxes.

## Admin interface and authorization

Add `/admin/settings/notifications` to the existing Admin navigation.

The page contains:

- an add-email form with five topic checkboxes;
- a table or compact responsive card list showing email, status, subscriptions, created time, and verified time;
- actions to resend verification, edit subscriptions, and delete/disable;
- a clear pending-verification state; and
- one prominent warning per topic that has zero active verified recipients.

Zero-recipient warnings are informational and do not block orders, payments, or proof decisions.

The page, reads, and mutations require the existing `manage_roles` permission. That permission is not assignable to Staff, so Staff cannot view or mutate this subsystem. Public verification endpoints accept only the opaque token flow and expose no Admin data.

All Admin mutations use trusted-origin validation, bounded schemas, and idempotency keys. Create, resend, subscription update, and disable actions write `admin_audit_logs` records containing safe before/after summaries. Verification completion is also recorded with a dedicated system verification actor and `request_source=public_verification_link`, so it is not falsely attributed to the Admin who created the invitation.

## Event production and delivery

### Event points

- `manual_order_created`: after the first successful commit of a production job whose source is `manual`; source event ID is the Production Job ID.
- `web_order_paid`: after a website order first reaches the verified paid state; source event ID is the Order ID.
- `payment_request_paid`: after a standalone Payment Request first reaches `paid`; source event ID is the Payment Request ID. Order-linked requests do not emit this topic.
- `proof_approved`: after a customer proof-review record with decision `approved` commits; source event ID is the proof-review record ID.
- `proof_changes_requested`: after a customer proof-review record with decision `changes_requested` commits; source event ID is the proof-review record ID.

Staff-authored proof status changes do not trigger the two customer-decision topics unless they use the existing authenticated customer proof-decision path and produce a customer review record.

For each event, the repository selects active verified subscriptions for that topic and inserts one outbox row per recipient with conflict-safe event keys. Zero matching recipients is a successful no-op. Recipient selection and outbox insertion occur within the surrounding business transaction where the existing repository boundary permits it, ensuring a committed event is not lost. Email-provider delivery always occurs later and never blocks the business operation.

The website-order and payment-request event producers stop deriving new internal recipients from `user.role = 'admin'`. They enqueue through the unified service instead. Customer notification kinds in the same legacy tables remain unchanged.

### Delivery

Extend the existing protected notification cron aggregation to drain the internal outbox alongside the current customer runtimes. The internal service follows the established claim/send/mark pattern:

1. atomically claim an available row;
2. verify its recipient is still active;
3. render a fixed server-owned internal template;
4. send through the existing Resend provider;
5. mark sent with provider ID, or record a safe error code and exponential retry availability.

The first release has fixed templates because this feature manages recipients, not content editing. Each message contains the event label, safe order/request reference, a short summary, and an authenticated Admin link. Proof files, full customer notes, full addresses, and payment details are not attached or embedded.

Provider configuration absence and provider failures are recorded and retried without changing business state. Database transaction failures retain normal all-or-nothing database behavior rather than silently losing the event.

## Market-switch API contract

`POST /api/market` remains trusted-origin, bounded JSON, no-store, and server-authoritative.

### Success

The existing success shape remains compatible:

```json
{
  "market": "NZ",
  "currency": "NZD",
  "cart": {}
}
```

The response sets the target-market cookie only after successful repricing. A cartless request omits `cart`.

### Recoverable urgent confirmation

Enhance checkout validation with safe structured error metadata and add a non-mutating market-switch preflight that identifies every cart item requiring target-market urgent confirmation. The route returns `409` without changing the cookie or cart:

```json
{
  "error": "Confirm urgent service or choose another completion date.",
  "code": "urgent_confirmation_required",
  "issues": [
    {
      "clientItemId": "cart-item-id",
      "productTitle": "Custom Themed Canvas",
      "neededDate": "2026-08-28",
      "urgentWorkingDays": 5,
      "urgentFeeInclGstCents": 2500,
      "currency": "NZD"
    }
  ]
}
```

All displayed product labels and fees come from the target-market registry and server pricing, not trusted client labels.

### Other failures

Unsupported market, disabled market, malformed cart, unavailable product/size, invalid dates, and server failures keep bounded safe messages and stable error codes. Internal stack traces and registry internals are never returned. The selector displays the safe message and offers cancellation or a cart review link instead of silently returning.

## Market-switch client flow

1. Disable the selector and show a compact pending state.
2. Load the active identity-scoped cart and post it to `/api/market`.
3. On success, save only the authoritative repriced cart, notify cart observers, clear only the active identity's stale checkout state, set the market event, and call one `router.push(...)`.
4. Do not call `router.refresh()` after the push.
5. On `urgent_confirmation_required`, restore the visible selector value and open a responsive modal listing all affected items.

The modal provides:

- `Confirm urgent service and switch`: set `urgentServiceConfirmed=true` only for listed items in a temporary cart copy, retry `/api/market`, and save only the returned authoritative cart;
- editable completion dates for affected items plus `Try new dates`: update the temporary dates, reset urgent confirmation for edited items, and retry authoritative repricing; and
- `Cancel`: close without changing cookie, market, or stored cart.

If new dates still require urgent confirmation, the modal updates with the new authoritative fee information. If any other validation fails, it displays the exact safe reason and leaves all stored state unchanged.

Repeated clicks while a request is pending are ignored. Modal controls remain keyboard accessible, trap focus while open, restore focus to the selector on close, and fit the existing mobile header design.

This change removes the silent failure and duplicate client refresh. Dynamic homepage rendering remains a known latency floor and is explicitly outside this focused change.

## Error handling and operational behavior

- Notification delivery errors store safe codes, never secrets or raw provider bodies.
- Verification email failure leaves a recoverable pending recipient.
- Duplicate add, expired token, reused token, stale subscription edit, and repeated disable operations return deterministic results.
- Outbox retry is idempotent; only a successful provider response marks a row sent.
- Disabled recipients cannot be claimed for new delivery.
- Market-switch errors never mutate the market cookie or persisted cart.
- A successful market switch stores server-repriced values before navigation.
- Customer order, payment, checkout, and proof actions retain their current behavior even when no internal recipient exists.

## Migration and rollout

Use one additive Drizzle migration for the three internal-notification tables, indexes, foreign keys, and checks. It does not alter existing orders, payments, proof reviews, users, customer addresses, customer outboxes, or historical notification rows.

No recipient backfill is inferred from current Admin accounts. After deployment, the Admin explicitly adds and verifies desired email addresses. Until then, each of the five topics shows a zero-recipient warning and creates no new internal delivery rows.

Rollout order:

1. run the additive migration in an isolated Test DB;
2. execute all database and non-database verification;
3. deploy schema and code using the approved production process;
4. add and verify operational recipient emails through Admin;
5. confirm each configured topic has at least one intended recipient or an explicitly accepted warning.

Production work must originate from a clean integration of current `origin/main`, pass the project production-source guard, and be verified by full commit SHA, Git source branch, Vercel READY status, and production aliases. Writing this design does not authorize a Production migration or deployment.

## Testing

### Unit tests

- email trim/lowercase normalization and validation;
- topic allowlist and subscription replacement;
- recipient status transitions;
- verification token digest, expiry, single-use behavior, and reissue invalidation;
- event-key construction and duplicate suppression;
- safe internal template payloads;
- outbox retry, sent, failed, and cancelled transitions;
- market error-code mapping and structured urgent issue metadata;
- single and multiple urgent-item preflight results;
- client confirmation/date-edit/cancel state transitions; and
- one navigation with no duplicate refresh.

### Isolated database integration tests

- schema checks and uniqueness constraints;
- concurrent duplicate recipient creation;
- Admin create/update/disable audit rows;
- public verification activation and expired-token rejection;
- disabling cancels pending/failed rows but preserves sent history;
- pending and disabled recipients are excluded from enqueue;
- one outbox row per active subscribed recipient;
- duplicate payment callbacks and proof actions do not duplicate rows;
- manual order commit produces the manual event;
- website paid transition produces the paid event only once;
- standalone payment-request paid transition produces the event only once, while order-linked requests do not emit it;
- proof approval and change-request review IDs produce distinct events;
- zero recipients is a successful business path; and
- customer outbox rows and recipients remain unchanged.

All database-dependent suites require an explicit isolated `TEST_DATABASE_URL`. Missing `TEST_DATABASE_URL` is not an acceptable final verification state.

### Route and permission tests

- Admin can list and mutate recipients;
- Staff receives 403 and cannot discover recipient data;
- unauthenticated Admin routes are rejected;
- verification GET is read-only and POST consumes the token;
- trusted-origin and bounded-body protection applies to all mutations;
- raw tokens never appear in list or audit responses;
- `/api/market` success, urgent-confirmation, validation, and server-error shapes; and
- a failed market switch does not set the market cookie.

### Browser verification

- AU to NZ and NZ to AU with no cart;
- a cart with a now-urgent completion date shows the modal;
- confirm urgent fee and complete one market transition;
- change the date and complete one market transition;
- cancel and confirm cart, cookie, and market are unchanged;
- multiple affected items are listed correctly;
- Admin adds an arbitrary address, sees pending state, verifies it, edits topics, and disables it;
- Staff cannot see the navigation item or open the page;
- zero-recipient warnings are visible; and
- mobile layouts remain usable.

### Release verification

- targeted Vitest suites;
- all 21 database-dependent suites with isolated `TEST_DATABASE_URL`;
- full non-database Vitest suite;
- TypeScript;
- ESLint;
- Drizzle schema check;
- Production build under the deployment-source guard; and
- post-deploy production smoke checks without sending test notifications to real recipients.

## Explicitly out of scope

- customer recipient or customer email-template management;
- SMS, push, digest, escalation, or scheduling rules;
- a second email provider;
- retroactive notification backfill;
- editing internal template wording in Admin;
- granting notification management to Staff;
- attaching proof images or customer files to notification emails;
- deleting or rewriting historical outbox/audit rows; and
- broad homepage caching or rendering refactors.

## Success criteria

- Market switching never silently fails and does not perform a duplicate refresh.
- Urgent target-market charges are explicitly confirmed or avoided through a user-selected date.
- Only active, verified, subscribed arbitrary emails receive the selected internal topics.
- Each business event produces at most one delivery per recipient.
- Disabling a recipient stops future and queued unsent internal delivery while preserving sent history.
- Zero-recipient configuration is visible but never blocks core business actions.
- Staff cannot view or mutate recipient configuration.
- Existing customer email behavior and recipients are unchanged.
- All required isolated database, unit, permission, browser, build, and deployment-guard checks pass before any production release.
