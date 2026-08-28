# Durable conversion outbox and authoritative paid transition

## Goal and boundary

Phase 0D makes manual-order conversion delivery durable without enabling a
provider. A manual payment transition and any eligible Google or Meta delivery
rows are committed in one PostgreSQL transaction. No OAuth, provider token,
Production flag, platform mutation, real API request, historical backfill,
Production migration, or Production deployment belongs to this phase.

## Existing system findings

- `production_jobs.manual_payment_status` is the authoritative manual-order
  payment state. The repository already locks the row with `FOR UPDATE`, but
  Phase 0C schedules conversion work after commit from the requested new value.
  That observer cannot prove a persisted non-paid to paid transition.
- Manual attribution and consent are stored only as allowlisted dynamic
  `production_field_values`. The current migration lineage does not guarantee
  that the required definitions exist.
- An issued invoice is the only authoritative currency source for a manual
  order. A conversion is ineligible unless its total equals the committed paid
  amount.
- Phase 0C's Google Data Manager client is mock-tested and fail-closed without a
  durable repository. Meta delivery is also disabled unless its separate
  configuration and managed switch are present.

## Schema

Add `production_jobs.manual_payment_confirmed_at timestamptz null`. Its first
non-paid to paid transition uses database time. It is never changed by a
paid-to-paid save or ordinary edit and is retained if staff later move the
display status away from paid. Returning to paid is the same payment lifecycle
and cannot create another Purchase.

Add `analytics_conversion_deliveries` with:

- immutable identity/event columns: `id`, `platform`, `transaction_id`,
  `job_id`, `event_type`, `event_occurred_at`, `event_source`, `currency`,
  `value_minor`, `consent_snapshot`, `attribution_snapshot`,
  `user_data_snapshot`, `created_at`;
- delivery state: `status`, `request_id`, `attempt_count`, `next_attempt_at`,
  `last_attempt_at`, `lease_token`, `lease_expires_at`, `last_error_code`,
  `last_error_category`, `last_error_at`, `accepted_at`, `completed_at`,
  `dead_lettered_at`, `updated_at`.

The database enforces one row per `(platform, transaction_id)`, valid platform,
state, currency, value, attempt count and lease shape. Indexes support due-state
claiming, job lookup, stale-lease recovery and request-ID lookup. A database
trigger rejects updates to immutable event and snapshot columns. `job_id` is an
indexed stable reference rather than a deleting foreign key so that an
operational delivery record is not silently deleted or allowed to change the
existing manual-order deletion contract.

The same migration creates the reserved manual fields for consent, source and
click identifiers using deterministic keys and conflict-safe inserts. These
fields record explicit staff-entered evidence; their absence, denial, malformed
timestamp or malformed identifier is ineligible. Nothing infers consent from a
customer source or from a previously displayed banner.

## Atomic paid transition

Inside the existing locked repository transaction:

1. Read the current persisted manual job with `FOR UPDATE`.
2. Validate optimistic concurrency and the requested update.
3. Detect `current.manualPaymentStatus !== "paid"` and requested status
   `=== "paid"` while `manualPaymentConfirmedAt` is still null.
4. Update payment state and set `manual_payment_confirmed_at` from PostgreSQL.
5. Read the committed row, issued invoice and new custom-field values inside the
   same transaction.
6. Build a minimal immutable candidate and insert platform rows only when that
   platform's feature flag and valid activation timestamp permit it, both order
   creation and confirmation are on or after activation, recorded consent is
   granted, the amount/currency are valid, and source evidence identifies one
   destination.
7. Commit.

An outbox insert error rolls back the payment update. A payment conflict creates
no outbox. The transaction ID is `manual-order:<production-job UUID>`; it is
stable, contains no PII and is reused for all retries. Google and Meta have
separate rows protected by the platform-scoped unique constraint.

Initially-paid job creation follows the same rule by treating the missing prior
row as non-paid, but remains ineligible without an issued invoice and explicit
recorded consent. No pending rows are created while a platform is disabled or
has no activation timestamp, so enabling the platform later cannot backfill old
orders.

## Snapshot and privacy

Snapshots are versioned JSON objects containing only:

- consent decision, decision time, policy version and evidence source;
- event source plus one valid `gclid`, `gbraid`, `wbraid`, `fbclid`, `fbp` or
  `fbc` where applicable;
- consent-permitted SHA-256 email/phone hashes.

They never contain raw email/phone, customer name, address, files, artwork,
design wording, payment proof, attachments or notes. Workers build provider
requests only from this immutable row, not by rereading the mutable job.
Application logs expose only delivery ID, job ID, platform, state, attempts,
masked transaction/request IDs, safe error enum and duration.

After 90 days, successful deliveries clear the three sensitive snapshots while
retaining identity, status and timestamps. Permanent/dead-letter rows clear
snapshots after 30 days. Phase 0D provides a bounded cleanup repository method;
no new scheduler or bulk replay UI is added.

## State machine and claiming

States are `pending`, `sending`, `accepted`, `processing`, `succeeded`,
`retryable_failed`, `permanent_failed` and `dead_letter`.

A single PostgreSQL `FOR UPDATE SKIP LOCKED` claim changes one due row to
`sending`, sets a random lease token and lease expiry, and increments attempts.
Rows with a request ID are poll work; rows without one are ingest work. Expired
`sending` rows recover to `accepted` when a request ID exists, otherwise to
`pending`. Every completion mutation must match the lease token, preventing a
stale worker from overwriting a newer claim.

Retry only network failures, 408, 429 and 5xx with bounded exponential backoff.
400, persistent authentication/permission failures, invalid destination or
event data are permanent. Google accepts one delivery per ingestion request,
stores the request ID, waits approximately 30 minutes before first status poll,
then uses a 1.3 multiplier capped at 60 minutes for at most 24 hours.
`PROCESSING` remains nonterminal. `SUCCESS` alone succeeds. `PARTIAL_SUCCESS`
and `FAILED` retain safe diagnostics and do not succeed. Exhausted delivery or
observation becomes dead-letter; there is no replay-all or historical repair
surface.

## Runtime gates

The dispatcher accepts separate provider adapters. Google requires the global
manual flag, Google flag, valid activation, durable repository, valid OAuth and
valid destination. Meta requires the global manual flag, Meta flag, valid
activation, durable repository, approved managed Meta switch and token. If any
runtime requirement is absent, the dispatcher does not claim work and performs
no network request. Phase 0D finishes with both provider runtimes disabled.

## Migration and rollback

The migration is additive: one nullable production-job timestamp, one new
table, indexes/checks/immutability trigger and conflict-safe field-definition
rows. It is validated on a fresh dedicated Test DB and on a clone of the
pre-Phase-0D schema. Production is not migrated in this phase.

Rollback before any provider activation: stop workers, drop the immutability
trigger/function and delivery table, remove only the deterministic field
definitions if unused, then drop `manual_payment_confirmed_at`. After provider
activation, preserve delivery audit rows and use a forward fix rather than
discarding sent identities.
