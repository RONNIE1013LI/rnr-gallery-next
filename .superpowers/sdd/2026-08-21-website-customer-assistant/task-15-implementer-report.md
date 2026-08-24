# Phase 3.7 Task 15 Implementer Report

## Scope

- Added channel-filterable Reply Assistant metrics for Website/Facebook sessions, meaningful turns, responses, direct templates, NO_REPLY, reviews, alerts, rate/budget blocks, provider usage/cost/latency, public-update latency, and fixed zero isolation/action/send counters.
- Added a bounded authenticated retention cron for seven-day Website sessions, at-most-24-hour rate data, expired deep-link hashes/selectors, and 90-day Website conversation anonymization.
- Retention is Website-only, idempotent, conversation-lock/CAS safe, and protects open/recent reviews, active order/dispute/legal holds, recent activity, and pending/running turns. It also redacts linked Website draft and feedback text.
- Added a deterministic exact-key 120-case Website structured-decision/template evaluator. No image AI, Production, Payment Requests, Facebook callback/workflow, policy gate, output validator, structured renderer, or send behavior changed.

## RED Evidence

- Initial focused unit run failed because `calculateChannelMetrics`, `channelMetricCards`, the retention handler, and the Website evaluator did not exist.
- Initial focused PostgreSQL run failed because the additive Task 15 tables/column were absent.
- The NO_REPLY engine regression failed because no durable `website_no_reply_needed` outcome marker was persisted.
- The dashboard regression failed because no Website metrics selector existed.
- The first evaluator run exposed one fixture over-block caused by a production case classified as design; the fixture was corrected without changing production policy, prompt, model, or renderer logic.
- Final retention self-review RED: the real PostgreSQL test received `private-expired-draft` instead of `[expired website chat]`; the same locked transaction now redacts attempt and feedback text.

## GREEN Evidence

- Focused unit/security/UI/evaluator checks: 27/27 passed; Website evaluator 2/2 passed; focused engine/metrics/retention checks 23 passed.
- Focused PostgreSQL metrics/retention/rate-boundary/race tests passed, including exact `<= now` cleanup, `now + 1ms` preservation, idempotency, and two workers.
- Final serial Customer Service and relevant PostgreSQL run on fresh `rnr_task15_test_20260822_0844`: 84 files, 1169/1169 tests, zero skips.
- `npm run typecheck`, `npm run lint -- --quiet`, `npm run db:check`, `npm run knowledge:check`, and `git diff --check`: PASS.
- Privacy audit: PASS across 11 tables, zero forbidden rows/columns/scope violations/residual rows. Customer Service secret and no-send scans: PASS. Polling/provider and Facebook regressions are included in the 1169-test run.

## Migration

- Added additive `drizzle/0052_next_human_robot.sql`, snapshot, and journal row.
- Adds `customer_service_conversations.anonymized_at`, `customer_service_retention_holds`, `customer_service_website_metric_events`, and supporting indexes/checks. No DROP/TRUNCATE/removal operation.
- Clean replay on the fresh isolated database applied 53 journal rows; latest timestamp `1787385600003`, latest SQL hash matched, and both Task 15 tables were present.

## 120-Case Website Evaluation

- Total/gate matches: 120/120. Direct template replies: 60. Useful responses: 60. Permitted NO_REPLY: 10. Human review: 40. Provider-path cases: 80.
- Required-information coverage: 100%. Naturalness: 100%. Over-block: 0.
- Policy bypass, unsupported realtime claim, direct unsafe free text, unsupported claim, cross-session leakage, automatic business action, and automatic send: all 0.
- Deterministic structured-output estimate: 4482 provider output tokens versus 2100 rendered reply tokens, delta +2382. No live provider input tokens or spend were incurred; estimated cost and cost delta are 0 for this offline evaluator.

## Unchanged Evaluations

- Phase 3.5 conversation evaluation: 18 cases; context/short-reply/direct/assisted accuracy 100%, unnecessary drafts/leakage/bypasses 0, deterministic cost 0.
- Phase 3.6 learning evaluation: 50 cases; capture/matching/retrieval precision 100%, leakage/conflict/realtime/high-risk reuse/bypass/violation/send 0, direct approval 50%, assisted acceptance 100%.
- Existing Facebook evaluator production-path unit regression: 1/1 passed; risky/realtime cases remained pre-provider and the allowed draft remained directly usable.
- Real unchanged OpenAI/Facebook evaluation was not run because `OPENAI_API_KEY` is unavailable in this environment. No result was fabricated and no prompt/model/dataset was changed.

## Files

- Metrics/UI: `metrics.ts`, repository DTO/Drizzle implementation and tests, `metric-cards*`, `live-dashboard*`, page, CSS, engine NO_REPLY telemetry.
- Retention/schema: new internal retention route/handler/tests, customer-service schema, migration/snapshot/journal, `vercel.json`, privacy/schema/security/no-send tests.
- Evaluation: `scripts/evaluate-website-customer-service.ts`, 120-line JSONL fixture, evaluator test, and `package.json` script.

## Remaining Task 16 Blockers

- Real OpenAI evaluation needs credentials/network and must run unchanged.
- Ronnie must approve the exact 90-day retention and complete the 20-response quality review.
- Staging must verify OpenAI data-sharing settings, Resend delivery/dedupe/deep links, real-browser mobile/desktop behavior, and the approved privacy notice before Production.
