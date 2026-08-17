# Task 2 Report: Conservative Unknown-Provider Settlement

## Root Cause

`settleImageJobBudget` converted both absent image/text `estimated_cost_microusd` values to zero. A durable `providerCalled=true` marker could therefore be followed by stale reconciliation or terminal cleanup that released the combined reservation without recording spend. The vision runner and image-aware text failure path also persisted `0` for an unavailable provider result, erasing the difference between a durable zero cost and unknown usage.

## RED Evidence

- Isolated PostgreSQL repository and runner run: 35 tests, 4 intended failures.
  - Started stale vision timeout, stale draft, and provider-error paths each released `2_000` microusd with `spent_microusd=0`.
  - The vision timeout runner persisted `estimatedCostMicrousd: 0` instead of an absent value.
- Isolated engine run: 20 tests, 1 intended failure. Image-aware text timeout also persisted `estimatedCostMicrousd: 0`.

## GREEN Evidence

- Repository integration, runner, and engine: 3 files, 55 tests passed.
- Budget, metrics, repository/concurrency, runner, and engine matrix: 5 files, 60 tests passed.
- Full customer-service suite on the dedicated disposable PostgreSQL database: 29 files, 304 tests passed, zero skips.
- `npm run typecheck`: passed.

## Changed Files

- `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- `src/server/customer-service/repositories/customer-service-repository.ts`
- `src/server/customer-service/image-job-runner.ts`
- `src/server/customer-service/engine.ts`
- `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`
- `src/server/customer-service/image-job-runner.test.ts`
- `src/server/customer-service/engine.test.ts`

## DB And Accounting Invariants

- The pre-provider image job keeps one combined reservation.
- A durable `providerCalled=true` paired with an absent actual cost (`NULL`) debits the combined reservation ceiling, or a higher durable actual total if one exists.
- A durable not-started attempt releases zero spend; a durable actual cost, including zero, remains authoritative.
- `budget_settled_at IS NULL` is claimed by a transaction-local CAS before either budget row changes. A failed CAS performs no debit, preserving exact-once reconciliation and completion settlement.
- Successful image/text attempts continue to settle their actual total once; the existing `25 + 40 = 65` microusd test remains green.

## Commit

- Implementation: `15cb36e fix: settle unknown image provider outcomes conservatively`

## Concerns

- An ambiguous provider call intentionally consumes the full combined reservation ceiling and can therefore overstate the eventual upstream charge. This is the conservative hard-stop policy required when durable usage is unavailable.
- No Production, deployment, schema, or migration changes were made.
