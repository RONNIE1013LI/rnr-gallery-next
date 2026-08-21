# Phase 3.7 Task 15 Fix Round 1 Report

## Scope

- Closed retention starvation by applying the complete Website eligibility predicates before `LIMIT`, while retaining the same checks under the conversation lock.
- Bounded every rate-limit bucket to 24 hours in application code and PostgreSQL while preserving the separate seven-day Website session.
- Made the 120-case evaluator use independent expectations and production policy, structured decision, renderer, and opaque session ownership boundaries.
- Deduplicated direct-template/NO_REPLY metrics per meaningful turn, persisted alert suppression counts, and relabelled cross-session isolation as a test-only invariant rather than observed telemetry.
- Added the bounded human-review deep-link cleanup index. Facebook, Production, Payment Requests, policy/validator/renderer safety, and no-send behavior were not changed.

## RED Evidence

- Fresh PostgreSQL focused run: 3/3 new tests failed as intended. The generated `session_total` bucket spanned `604800000ms`, protected oldest conversations yielded `0` eligible progress, and the cleanup plan lacked `customer_service_human_reviews_deep_link_expiry_idx`.
- Evaluator focused run: 5/6 failed. Missing effect recorder/literal checks, mutable quote expectations, and the fixture-owned `sessionOwnerMatches` boolean were independently exposed.
- Metrics RED: UI lacked alert dedupe/test-only isolation; PostgreSQL lacked `deduplicated_count`; the impossible direct plus duplicate NO_REPLY fixture was not mutually classified.

## GREEN Evidence

- Focused unit/UI/schema/evaluator: 27/27, then final schema contract 11/11.
- Focused real PostgreSQL: 5/5, covering rate boundary/CHECK, protected rows before limit, repeated/concurrent retention, alert reuse count, distinct turn outcomes/channel isolation, and EXPLAIN index use.
- Fresh isolated Customer Service/Reply Assistant run: 88 files, 1215/1215 tests, zero skips.
- Full repository run: 444 files passed and 3452/3453 tests passed, zero skips. The sole failure was unrelated `customer-reviews-section.test.tsx`: its date-sensitive expectation requested `today` while the rendered relative date was `yesterday`; no unrelated fix was made.
- `npm run typecheck`, `npm run lint -- --quiet`, `npm run db:check`, `npm run knowledge:check`, and `git diff --check`: PASS.
- Privacy audit: PASS across 11 tables, zero forbidden rows/columns, scope violations, or residual rows. Changed-file provider/no-send and runtime privacy/secret scans: clean.

## Migration

- Added forward-only `drizzle/0053_ambiguous_otto_octavius.sql`, snapshot, and journal row.
- Adds nullable-free/defaulted `deduplicated_count`, its nonnegative CHECK, the 24-hour rate-window CHECK, and `customer_service_human_reviews_deep_link_expiry_idx`.
- No DROP, constraint replacement, TRUNCATE, DELETE, or commerce-table operation.
- One-pass replay on fresh `rnr_task15_fix_round1_final_test_20260822`: 54 journal rows, latest timestamp `1787385600004`, latest SQL hash matched.

## Evaluations

- Website: 120/120 gate matches and 120/120 outcome matches; 60 direct, 60 useful, 10 NO_REPLY, 40 human review; required-information coverage and naturalness 100%; over-block 0.
- Website safety: policy bypass, realtime claim, arbitrary provider literal, unsupported claim, cross-session leakage, business action, and external send all 0. Provider-path cases 80; output tokens 4482; rendered delta +2382; offline cost 0.
- Phase 3.5 unchanged: 18 cases, context/short-reply/direct/assisted accuracy 100%, leakage/bypass/unnecessary drafts 0.
- Phase 3.6 unchanged: 50 cases, capture/matching/retrieval precision 100%, leakage/conflict/realtime/high-risk reuse/bypass/violation/send 0, direct approval 50%, assisted acceptance 100%.
- Existing unchanged Facebook evaluator regression passed inside the 1215-test run. No live OpenAI evaluation was fabricated.

## Bounded Ruling

- `session_total` is now a deterministic fixed 24-hour segment within the seven-day opaque session. This retains the 100-request cap per segment without retaining rate records for the session lifetime; the session cookie/identity remains seven days.
- Cross-session access is rejected before durable business telemetry exists, so the dashboard reports `Invariant / test-only` instead of a fabricated observed zero.
