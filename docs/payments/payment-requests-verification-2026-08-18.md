# Payment Requests Verification — 2026-08-18

## Release boundary

- Branch: `feat/payment-requests`
- Base: `3af1529cde7a76e246bdcb277fa79bbd08fe4f4a`
- This verification did not push, promote or deploy the branch.
- No real provider session or real charge was created.

## Automated verification

| Check | Result |
| --- | --- |
| Baseline full Vitest run | PASS — 342 files, 2,584 tests |
| Payment Request database integration | PASS — 2 files, 27 tests, isolated test DB |
| Completed feature full Vitest run | PASS — 357 files and 2,635 tests; 4 files and 35 tests skipped by their existing guards |
| Route/admin regression after final build fix | PASS — 7 files, 20 tests |
| TypeScript | PASS — `npm run typecheck` |
| ESLint | PASS — 0 errors; 3 pre-existing unused-parameter warnings |
| Drizzle schema check | PASS — `npm run db:check` |
| Production build | PASS — compiled, typechecked and generated 96/96 pages |
| Diff whitespace check | PASS — `git diff --check` |

The production build used the isolated test database plus a non-sensitive,
build-only HTTPS auth origin and high-entropy placeholder auth secret. The
first build attempt correctly stopped because the local environment did not
define `BETTER_AUTH_URL`; a second attempt with an HTTP production auth URL was
also correctly rejected. Neither failure required a product-code workaround.

The PostgreSQL client emitted its existing warning about future
`sslmode=require` semantics. It did not cause a test or build failure.

## Browser verification

The existing local site already occupied port 3000, so this isolated branch was
served on `http://192.168.4.199:3011` without interrupting it.

A temporary standalone request was created only in the isolated test database:

- Fixed amount rendered as `NZ$200.00`.
- The payment button rendered the same fixed amount.
- The amount was not an editable customer field.
- Card mode requested full name, email and optional phone only.
- Card mode did not request an address.
- Desktop and 390 × 844 mobile layouts rendered without horizontal overflow.
- The browser used the explicitly labelled local-test provider; the payment
  button was not pressed.
- The temporary Payment Request and temporary administrator were deleted after
  the check.

The only browser console diagnostic was the same PostgreSQL SSL future-semantics
warning surfaced through the development overlay; there was no Payment Request
runtime exception in the successful run.

## Security and business-rule coverage

Automated tests cover:

- Database XOR target enforcement for `payment_attempts`.
- Request amount/currency matching at the database boundary.
- Aggregate request reservation limits against current Order outstanding.
- Fresh outstanding-balance validation immediately before provider session
  creation.
- Automatic invalidation when later ledger credits make a request too large.
- Provider success idempotency and immutable online-payment ledger credits.
- Bank-transfer append and one-time reversal behavior.
- Token hashing, rotation and old-token rejection.
- `manage_payment` protection for admin mutations and views.
- Public DTO privacy boundaries and terminal/unavailable request UI.
- Stripe and Afterpay Payment Target mapping.
- NZD/AUD preservation through request, attempt, provider and ledger records.

## Migration incident recorded during implementation

While applying migration `0032_sad_maria_hill.sql`, `drizzle.config.ts` read
`DATABASE_URL` rather than the already-validated `TEST_DATABASE_URL`. The
migration therefore ran once against the configured production database before
being run explicitly against the isolated test database.

Migration 0032 is additive and idempotency-focused: it adds two idempotency
columns, backfills existing Payment Requests if any, makes the request key
required and adds two unique indexes. It does not delete orders, alter product
prices or change order/payment amounts. No application code was deployed as
part of that incident, and no destructive rollback was attempted.

## Remaining manual checks before a later production release

- Review the final migration plan and production environment variables.
- After an explicit deployment request, create one low-risk admin test request
  and verify the public link with the configured live/sandbox providers.
- Verify provider return/webhook behavior without assuming a successful real
  charge from a previous feature is proof of this new target type.
- Confirm authorised staff roles match the intended `manage_payment` access.
