# Task 10 Fix Round 1 Report

## Changes

- Alert emails now render a fixed website-review summary from the allowlisted review reason and never render `redactedSummary` customer content.
- Due-alert claiming now requires `deep_link_expires_at > now`, so an expired link cannot be leased or sent.
- Added adversarial email privacy coverage, expired-link DB coverage, expired/reclaimed stale-lease settlement coverage, and direct chat-route fail-soft coverage.
- The approved one-minute review-alert Cron remains unchanged. No production deployment or configuration change was made.

## TDD Evidence

- RED: the privacy regression failed because `021.234.5678` remained in the delivered email.
- RED: the DB regression failed because an alert with `deepLinkExpiresAt === now` was claimed.
- GREEN: both regressions pass after the minimal service and query changes.
- The new stale-lease and route fail-soft regressions passed against the base implementation: the existing lease-token CAS and scheduled-task catch already enforced those behaviors. They were retained as direct regression coverage without modifying those paths.

## Verification

- Focused Task 10 tests: 81 passed.
- Isolated serialized DB suites: 124 passed using `TEST_DATABASE_URL` from `../payment-adapters/.env.local` with `--maxWorkers=1 --no-file-parallelism`.
- No-send, Policy Gate, and security tests: 23 passed.
- `npm run typecheck`: passed.
- `npm run lint`: exited 0 with three pre-existing warnings in unrelated mock-provider/OpenAI test files.
- `npm run db:check`: passed.
