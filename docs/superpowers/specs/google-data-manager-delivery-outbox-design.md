# Google Data Manager delivery outbox design

## Status

`BLOCKED_PENDING_DURABLE_OUTBOX_MIGRATION`

Google Data Manager execution must remain disconnected from order persistence in
Phase 0C. The active migration freeze prohibits creating or applying this
schema. A future, separately approved migration and platform/OAuth phase are
required before Production execution can be enabled.

## Authoritative transition boundary

The current manual-job save observer receives request intent plus a successful
save; it cannot reliably prove the committed transition was non-paid to paid.
It also does not cover initially-paid manual jobs, normal web-order payments,
or bank-transfer and payment-request flows. Future wiring must consume an
authoritative, committed payment transition with immutable `createdAt` and
`manualPaymentConfirmedAt`, then create the delivery row in the same database
transaction. It must never substitute `updatedAt`, an `after()` execution time,
or deployment time for payment confirmation.

## Required record

Create a provider-neutral conversion-delivery outbox with an immutable,
reconstructable event snapshot. The committed, authoritative payment transition
must atomically create that snapshot and its `pending` outbox row in one
database transaction. A mutable order/job record or a payload digest alone is
not a retry source.

The snapshot must contain the exact delivery inputs needed to rebuild the same
Data Manager event without rereading mutable business data:

- `source_event_id`, immutable internal order/job reference,
  `prior_payment_status`, `current_payment_status`, `order_created_at`, and
  `manual_payment_confirmed_at`;
- recorded consent evidence (decision, recorded timestamp, policy/version and
  source), stable event source, destination configuration snapshot, and
  `payload_version`/`payload_digest`;
- the exact stable `transaction_id`, exact normalized click ID when present, and
  the exact SHA-256 user-data hashes when consent permits. It must never include
  raw email, phone, address, artwork, notes, payment evidence, or other raw PII.

Store those event fields together in `encrypted_event_snapshot`, protected with
application-layer encryption and an `encryption_key_version`. The future design
must use authenticated encryption with keys outside the database, decrypt only
inside the delivery worker, and enforce service-role access control plus audited
break-glass access. Operators, regular application readers, logs, and exports
must not receive the decrypted snapshot.

At minimum the row also needs protected exact `transaction_id` and
`request_id` columns, `platform`, `state`, `attempt_count`, `next_attempt_at`,
lease/claim metadata, `last_attempt_at`, final request-status metadata, safe
error and warning enums, `last_error_code`, `last_error_at`, `completed_at`,
`created_at`, and `updated_at`. `request_id` is initially null and is updated
with the exact provider value after acceptance so polling can resume after a
crash. Exact values are masked only in logs and operator displays, never in the
protected columns used for polling or idempotency.

The immutable identity is the approved transaction ID, not a fresh UUID per
retry. The future migration needs a unique `(platform, transaction_lookup)`
constraint, where `transaction_lookup` is a keyed deterministic lookup derived
from the exact protected `transaction_id`; a concurrent duplicate must return
the existing row. This preserves the required exact identity without exposing
it in a broadly readable database index. Successful Google delivery is
idempotent only when this local state and the same transaction ID are preserved
across process crashes and retries.

## State machine

`pending` is created atomically with the confirmed payment transition. A worker
claims it as `sending`; a successful ingestion response with a valid request ID
becomes `accepted`, and polling moves it to `processing` or `succeeded`. Only a
Data Manager per-destination `SUCCESS` may produce `succeeded`.

`PROCESSING` is not success. `PARTIAL_SUCCESS`, `FAILED`, invalid payloads,
invalid destinations, denied or unknown consent, and invalid payment/currency
data are terminal `permanent_failed` states. Retryable transport outcomes move
to `retryable_failed`; a leased worker later returns eligible records to
`pending`. Attempts exhausted by policy move to `dead_letter` for controlled
operator review and an explicit, audited requeue or terminal close.

## Retry, recovery, and operations

Retry only timeouts, connection resets, HTTP 408, HTTP 429, and HTTP 5xx using
bounded exponential backoff with jitter and `next_attempt_at`. HTTP 400,
authentication failure after token refresh, HTTP 403, invalid account or
conversion action, consent failure, and invalid value/currency/timestamp are
permanent. Do not implement a retry worker until the durable repository exists.

On worker crash or lease expiry, reclaim `sending`, `accepted`, or `processing`
records safely according to their lease and request ID. An accepted request must
resume status polling rather than ingesting the event again. Dead-letter
operations must be authenticated, auditable, rate-limited, and preserve the
original immutable identity; they must not replay from mutable order fields.

## Privacy and observability

Protected durable delivery columns retain exact `transaction_id` and `request_id`
for uniqueness and status polling. Logs, operator displays, and unprotected
observability contain masked transaction/request IDs only, together with platform,
internal reference, state, safe reason enums, HTTP status, attempt count,
timestamps, and duration. Never log OAuth material, raw or hashed user data,
click IDs, request bodies, addresses, designs, notes, payment evidence, or a
decrypted snapshot. The encrypted snapshot is protected delivery state, not an
audit-log payload.

After the approved terminal retention period, purge `encrypted_event_snapshot`
and any decryptable delivery identifiers, while retaining only the minimum
non-sensitive terminal metadata needed for audit and duplicate prevention.
Dead-letter review must be time-bounded: an authenticated reviewer either
requeues an eligible record or closes it, then the record expires under the same
approved retention policy. Every purge, dead-letter close, and deletion must be
auditable without recording the removed sensitive value. Exact payload,
metadata, and dead-letter retention durations remain a privacy/legal decision;
their approval is a pre-migration activation gate, so Google activation stays
blocked until it is documented and enforced.

## Activation gate

After the migration, execute eligibility still requires both feature flags, a
valid `GOOGLE_MANUAL_CONVERSIONS_ACTIVATED_AT`, order creation and confirmed
payment at or after that timestamp, explicit recorded advertising consent,
eligible matching evidence, a proven non-paid to paid transition, and no
successful delivery row. Historical backfill remains disabled unless separately
approved.
