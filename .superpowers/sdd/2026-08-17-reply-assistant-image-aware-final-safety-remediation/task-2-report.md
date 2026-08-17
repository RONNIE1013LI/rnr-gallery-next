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

## Review Remediation

### Root Cause

- Both OpenAI providers converted omitted or malformed successful-response usage into numeric zero or `NaN`. That made an unknown paid response look like a durable zero-cost response.
- `completeImageAnalysisAttempt` used the mutable completion payload to calculate its unknown-cost fallback and then overwrote the locked `provider_called` marker. A contradictory completion could downgrade a durable provider start and release its reservation with zero spend.

### RED Evidence

- Provider and repository integration run: 42 tests, 5 intended failures. Omitted usage produced `0`, malformed usage produced `NaN`, and two contradictory completions changed `provider_called` to false while releasing 100 microusd with zero spend.
- Image-provider cached-usage probe: 8 tests, 1 intended failure. `cached_tokens: null` became a known 28-microusd cost instead of an unknown cost.

### GREEN Evidence

- OpenAI text and image provider regressions: 2 files, 14 tests passed.
- Provider/repository focused set: 3 files, 42 tests passed.
- Customer-service plus evaluator suite on the dedicated disposable PostgreSQL database: 31 files, 327 tests passed, zero skips.
- `npm run typecheck`: passed.

### Changes And Invariants

- `AiProviderResult` and `ImageAnalysisProviderResult` now carry `estimatedCostMicrousd: number | null`.
- Missing, non-integer, negative, or malformed usage remains `NULL` cost; complete numeric usage, including actual zero, remains authoritative.
- Engine, image runner, attachment processor, repository, and evaluator adapters preserve `NULL` rather than rewriting it to zero.
- `completeImageAnalysisAttempt` reads the locked durable marker, charges its reservation when the cost is unknown and either marker is true, and writes `provider_called = provider_called OR input.providerCalled`.
- Concurrent and repeated contradictory completions remain exact-once: the marker stays true and the 100-microusd reservation is debited once.

### Changed Files

- `src/server/customer-service/providers/ai-provider.ts`
- `src/server/customer-service/providers/image-analysis-provider.ts`
- `src/server/customer-service/providers/openai-responses.ts`
- `src/server/customer-service/providers/openai-image-analysis.ts`
- `src/server/customer-service/providers/openai-responses.test.ts`
- `src/server/customer-service/providers/openai-image-analysis.test.ts`
- `src/server/customer-service/attachments/attachment-processor.ts`
- `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`
- `scripts/evaluate-reply-assistant-images.ts`
- `scripts/evaluate-reply-assistant-quality.ts`

### Commit

- Review remediation implementation: `8be7a7f fix: preserve unknown provider usage costs`

## Fix Round 2

### Root Cause

- Both provider parsers accepted `cached_tokens` greater than `input_tokens`. The cost estimator then clamped the impossible cached count and returned a numeric zero, making unusable usage authoritative instead of preserving the unknown-cost signal.

### RED Evidence

- Exact text and image provider regressions: 2 files, 18 tests, 2 intended failures. A successful response with `input_tokens=0`, `cached_tokens=1`, and `output_tokens=0` returned `estimatedCostMicrousd: 0` in each provider instead of `null`.
- The paired equality-boundary cases (`cached_tokens === input_tokens`) passed before the fix, proving that complete valid usage remained usable.

### GREEN Evidence

- Exact text and image provider regressions: 2 files, 18 tests passed.
- Focused provider/accounting matrix on the dedicated disposable PostgreSQL database: 8 files, 88 tests passed, zero skips.
- `npm run typecheck`: passed.

### Changes And DB/Accounting Invariants

- Both existing provider-local usage parsers now accept cached usage only when `0 <= cached_tokens <= input_tokens`; their existing non-negative safe-integer validation continues to reject other unusable token values.
- An internally inconsistent usage tuple returns `estimatedCostMicrousd: null`, preserving the durable unknown-cost signal through the existing repository path. A durable `providerCalled=true` with that absent actual cost consumes the applicable reservation ceiling exactly once under the existing transaction/CAS settlement.
- Complete equality-boundary usage remains authoritative and is charged from its actual calculated cost. No repository, schema, or settlement behavior changed in this round.

### Changed Files

- `src/server/customer-service/providers/openai-responses.ts`
- `src/server/customer-service/providers/openai-image-analysis.ts`
- `src/server/customer-service/providers/openai-responses.test.ts`
- `src/server/customer-service/providers/openai-image-analysis.test.ts`

### Commit

- Implementation: `f961303 fix: reject inconsistent provider usage`

### Concerns

- No Production, deployment, schema, migration, or accounting-path changes were made. Unknown provider usage intentionally remains conservative and can consume the reservation ceiling.

## Fix Round 3: Text Provider Exception Settlement

### Root Cause

The text engine exception path called `completeProviderAttempt` with `estimatedCostMicrousd: 0` after `reserveProviderAttempt` had durably marked the provider as called. A timeout or transport failure after dispatch therefore looked like authoritative zero cost and released the reservation instead of conservatively consuming it.

### RED / GREEN

- RED: the existing safe provider-error unit test was tightened to require `estimatedCostMicrousd: null` and failed on the persisted zero.
- GREEN: the engine now preserves unknown cost as `null`; focused provider/engine tests passed `26/26`.
- A database integration regression now races two identical unknown-result completions and requires the 100-microusd reservation to be charged exactly once. It compiles and is ready for the dedicated test database; the current local environment correctly skips it because no safe dedicated `TEST_DATABASE_URL` is available.
- TypeScript, focused ESLint, and `git diff --check` passed.

### Changed Files

- `src/server/customer-service/engine.ts`
- `src/server/customer-service/engine.test.ts`
- `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`

No policy gate, output validator, provider parser, schema, migration, Production configuration, or send capability changed.

### Independent Re-review

Commit `6da4ed6` was reviewed independently by the reviewer who identified the text-provider exception gap.

```text
Critical findings: 0
Important findings: 0
Unknown text-provider cost finding: CLOSED
SPEC: PASS
QUALITY: PASS
```

The reviewer confirmed that `null` reaches the locked repository transaction, consumes the reservation ceiling once, and repeated or concurrent completion cannot charge again after the attempt leaves `provider_pending`.
