# Customer proof and notification design

## Goal

Turn the existing private production-draft storage into a customer-facing proof loop without weakening order ownership, exposing other production files, or changing order prices. Staff continue to upload versioned drafts in the production job. The customer can inspect the current draft, approve it, or submit one consolidated change request from the order page.

## Authority and ownership

- PostgreSQL remains authoritative for orders, production jobs, files, reviews and fulfilment status.
- A signed-in customer may access only an order whose `customer_id` matches the session user.
- A guest may access only through the existing completed checkout-session cookie, or through a short-lived HMAC-signed proof link sent to the order email address.
- A proof link is bound to one order number, one design-draft file ID and an expiry. It does not expose an email address or database identifier in its signature payload.
- Customer file responses return only `design_draft` bytes. Customer files, print files, payment proofs and storage keys remain inaccessible.

## Workflow

1. Staff uploads a new `design_draft` to a production job.
2. The repository assigns the next immutable version, moves an eligible linked web order to `awaiting_customer`, and atomically creates one idempotent `proof_ready` outbox event.
3. The upload route attempts immediate email delivery when the provider is configured. A delivery failure never removes the draft; the outbox event remains retryable and visible to staff.
4. The order page shows version history and one decision form for the latest unreviewed draft.
5. Approval requires an explicit confirmation and moves the linked web order to `ready_to_print`.
6. A change request requires notes, records one immutable revision decision and moves the linked web order back to `designing`.
7. Only the latest unreviewed draft can receive a customer decision. Duplicate idempotency keys return the original result; reuse with different data conflicts.

Manual jobs retain the current staff-recorded decision workflow because they have no ecommerce order owner. Staff may continue recording decisions received by Messenger, email, phone or WhatsApp.

## Revision policy

The existing two-free-revision calculation remains authoritative. Customer change requests increment the same revision summary as staff-recorded decisions. No fee is silently added. A third request only raises the existing additional-charge review warning; staff must confirm any charge with the customer before changing an order.

## Notifications

An append-only notification outbox stores the business event, destination, delivery state, attempt count and safe provider result. It never stores provider credentials or raw signed URLs. Proof links are generated immediately before delivery using the Better Auth secret with a domain-separated HMAC.

The delivery adapter uses the configured transactional-email provider only when all required environment values exist. Local development without credentials leaves events pending and makes that state explicit in the admin interface. A protected retry endpoint supports an administrator or scheduler; it cannot be called anonymously.

## Status safety

- Uploading a proof may move `new`, `designing`, `awaiting_customer`, `ready_to_print` or `on_hold` to `awaiting_customer`.
- Customer approval may move only `awaiting_customer` to `ready_to_print`.
- Customer changes may move only `awaiting_customer` to `designing`.
- Printing, shipped, completed and cancelled orders are never reopened automatically.
- Customer review and status transition occur in one transaction.

## UI

The proof panel is part of both authenticated account-order details and the guest order confirmation page. It uses the existing storefront typography, buttons, cards and breakpoints. The latest proof is visually primary; older versions are a compact history. Approval and change-request copy clearly explains production consequences and the two-revision rule.

The admin production file panel keeps its existing structure and adds a concise notification state for each design draft. No parallel design system is introduced.

## Explicit exclusions

- No automatic revision or source-photo fee.
- No customer access to manual jobs.
- No SMS, Messenger or WhatsApp automation.
- No marketing email.
- No background worker dependency; retry is adapter-driven and scheduler-ready.
- No change to payment, shipping, totals or immutable order snapshots.
