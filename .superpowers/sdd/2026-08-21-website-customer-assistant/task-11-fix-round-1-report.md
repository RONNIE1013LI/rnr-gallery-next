# Task 11 Fix Round 1 - Implementer Report

## Scope

Addressed the two Important review findings and the recovery-state Minor for
website customer-chat updates. The public response DTO remains limited to safe
states and does not expose the internal ordering key.

## RED Evidence

Before production changes, the focused update suite failed as expected:

- A database-default timestamp reader poll returned the first event twice and
  then the human event, proving millisecond `Date` cursor serialization could
  duplicate a PostgreSQL microsecond timestamp.
- The next repository call lacked an `orderingKey` cursor field.
- The event `EXPLAIN` used the received-at index and a sort rather than the
  required created-at keyset index.
- A turn with `processingAttempts = 1` was returned as `recovery` instead of
  `pending`.

## Implementation

- Repository selects a fixed-width UTC microsecond key with PostgreSQL
  `to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.
- The key flows from SQL row to repository record to the signed, session-bound
  cursor payload and is cast back to `timestamptz` in the next keyset
  predicate. It is never included in the public DTO.
- Ordering is `(orderingKey, source, id)`, preserving the established source
  tie-break and preventing gaps or duplicates across equal timestamps.
- Added the narrow partial event index
  `customer_service_website_public_events_keyset_idx` for public website event
  keyset reads. The existing assistant keyset index serves the assistant branch.
- The initial processing claim remains `pending`; `recovery` now requires
  `processingAttempts > 1`.

## PostgreSQL Evidence

The focused, isolated PostgreSQL suite is green with 20 tests across five
files. It includes:

- Two actual reader polls over database-default timestamps, asserting exactly
  two unique event keys and no duplicate or skipped update.
- `EXPLAIN (costs off)` for both event and assistant keyset queries with their
  cursor predicates and `ORDER BY ... ASC, id ASC` clauses. Both plans show an
  index scan and no sequential scan. PostgreSQL truncates the long assistant
  index identifier in plan text, so the assertion uses its emitted prefix.
- A first-claim/retry regression for `processingAttempts` 1 and 2.

The normal `db:migrate -- --environment test` guard verified the dedicated
test database but could not replay the historical migration chain because that
database already contains `customer_service_human_reviews` while its migration
journal lacks the corresponding historical entry. I did not repair or rewrite
that baseline. After the same identity guard verified the dedicated test
target, only the additive Task 11 index migrations `0047` and `0048` were
applied there for isolated plan testing.

## GREEN Verification

- Focused serial suite: 5 files, 20 tests passed.
- Full serial customer-service suite: 55 files, 857 tests passed in 304.22s.
- `npm run typecheck` passed.
- `npm run lint` completed with 0 errors and 3 pre-existing warnings in
  unrelated provider files.
- `npm run db:check` passed.
- `no-auto-send.test.ts` passed explicitly (1 test).
- `git diff --check` passed.

## Bounded Ruling

`rate` remains a transient POST result and is not reconstructed by GET update
polling. This fix does not add rate-state persistence or broaden the public
state model.
