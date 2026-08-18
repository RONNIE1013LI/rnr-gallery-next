# Task 7 report — employee permission boundaries

## Scope completed

- Added isolated migrated-database coverage for order viewer, payment operator,
  assigned artist, content editor, missing profile, unknown-key profile,
  malformed profile, database Admin, and existing `form_staff` preset access.
- Verified exact grants and denials for Payment Requests, refunds, finance,
  customer contact, audit, publishing, and `manage_roles`.
- Extended protected-route coverage for exact payment grants, assigned-only
  Staff scope, finance denial, and private-file denial.

## Concrete fix

The new audit privacy test initially failed because nested `request.body` data
survived recursive sanitisation. `audit-service.ts` now treats every `body`
field as sensitive, preventing raw failure payloads (including credentials)
from entering audit summaries.

## Verification

- Focused security matrix: 11 test files, 56 tests passed using the isolated
  `TEST_DATABASE_URL` after loading the payment-adapters local environment.
- `npm run typecheck`: passed.
- `npm run lint`: passed with 3 pre-existing unused-parameter warnings in
  customer-service provider files outside this task.
- `git diff --check`: passed.

## Boundaries

- No production migration, push, deployment, payment/order/ledger change, or
  credential material was introduced.

## Review follow-up

- Added default-route integration coverage with profiles persisted to the
  isolated test database. The test provides only an authenticated test session;
  both protected routes use their real default permission resolver and database
  lookup. Payment Requests deny the order viewer and missing profile (403),
  while the payment operator reaches request validation (422). Forms allows an
  assigned artist (200), denies a missing profile (403), and hides a job after
  reassignment (404).
- Added persisted audit coverage for real employee creation, access change, and
  failure audit writes. It recursively checks all values and JSON serialisation
  for the plaintext-password and stored-hash test substrings.
- Tightened raw-request redaction to exact body/raw-request aliases. `bodyLength`
  and `somebodyApproved` are now retained by regression tests.
- Review verification: focused matrix 11 files / 60 tests passed; typecheck
  passed; lint exited 0 with the same 3 pre-existing task-external warnings;
  `git diff --check` passed.

## Final permission regression follow-up

- Forms private-file GET now proves that a `view_jobs`-only grant is denied
  before scope or file services run, while an exact `view_files` grant is
  allowed. The route test asserts the resolver receives `view_files`.
- Forms invoice PUT now proves that a `view_finance`-only grant is denied
  before scope or draft mutation services run, while an exact `update_finance`
  grant is allowed. The route test asserts the resolver receives
  `update_finance`.
- Final focused matrix: 11 files / 63 tests passed; typecheck passed; lint
  exited 0 with the same 3 task-external warnings; `git diff --check` passed.
