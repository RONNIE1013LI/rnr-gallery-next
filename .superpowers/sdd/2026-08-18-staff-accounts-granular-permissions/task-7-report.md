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
