# Task 1 Report - Terminal Pilot Jobs Cannot Be Recovered

## Status

Complete. `pilot_complete` intake no longer persists a runnable image job or its encrypted source, and recovery claims require the linked message to be pilot-bound.

## Root Cause

`ingestFacebookMessage` inserted a pending `customer_service_image_jobs` row, including `source_ciphertext`, before it locked and checked the active pilot. When no pilot was active or its limit was exhausted, it returned `pilot_complete` but left that runnable row behind. `claimImageJob` selected all due pending jobs without checking `customer_service_messages.pilot_run_id`, so recovery could lease that row.

## RED Evidence

Command run against a fresh disposable PostgreSQL database after applying the existing migrations:

```bash
TEST_DATABASE_URL=<disposable-test-db> DATABASE_URL=<distinct-safety-target> npm run test:run -- src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts -t 'omits runnable image work when the pilot is complete|does not recover a legacy runnable image job without a pilot-bound message'
```

Output: `1` test file failed; `2` tests failed; `23` filtered tests skipped. The first test found one pending image job containing `v1.encrypted-source` after `pilot_complete`. The second received one claimed legacy job and one `null` instead of `[null, null]` from concurrent recovery claims.

## Implementation

- Lock and evaluate the active pilot before creating any image job. Only pilot-bound messages receive an image job and its encrypted source.
- Require `customer_service_messages.pilot_run_id is not null` in the transactional image-job claim query.
- Add integration coverage for omitted pilot-complete work, concurrent and repeated recovery claims, and pre-existing non-pilot pending jobs.
- Update existing image-job lifecycle tests to create an active pilot explicitly.

## GREEN Evidence

All commands used the same disposable database, with `TEST_DATABASE_URL` and a distinct `DATABASE_URL` safety target.

```bash
npm run db:migrate
```

Passed: existing migrations applied successfully.

```bash
npm run test:run -- src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts -t 'omits runnable image work when the pilot is complete|does not recover a legacy runnable image job without a pilot-bound message'
```

Passed: `1` file, `2/2` tests.

```bash
npm run test:run -- src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts
```

Passed: `1` file, `25/25` tests, zero database skips.

```bash
npm run test:run -- src/server/customer-service/meta/webhook-handler.test.ts src/server/customer-service/image-job-runner.test.ts src/server/db/schema/customer-service-schema.test.ts src/server/customer-service/security-regression.test.ts src/server/customer-service/no-auto-send.test.ts src/server/customer-service/serverless-compatibility.test.ts
```

Passed: `6` files, `42/42` tests, zero database skips.

```bash
npm run typecheck
git diff --check
```

Passed.

## Changed Files

- `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`
- `.superpowers/sdd/2026-08-17-reply-assistant-image-aware-final-safety-remediation/task-1-report.md`

## Migration

None. The existing persisted message-to-pilot relationship is sufficient for the repository/CAS enforcement query; no additive schema change is required.

## Commit

`fix: prevent recovery of non-pilot image jobs` (this commit contains the report).

## Concerns

No deployment or Production state changed. Pre-existing non-pilot pending jobs are now unclaimable, but this task intentionally does not mutate or purge historical rows; new `pilot_complete` intake stores no image job or protected source material.
