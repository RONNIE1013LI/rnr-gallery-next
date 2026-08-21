# Phase 3.7 TDD Ledger

Baseline: `365577c` plus design commit `877fdb6`
Branch: `feat/website-customer-assistant`
Production changes: forbidden

| Task | Scope | Status | RED | GREEN | Commit |
| --- | --- | --- | --- | --- | --- |
| 1 | Channel-separated configuration | completed | 6 failures, then 4 review regressions | 32/32 pass; spec and quality reviews PASS | b4a6504 |
| 2 | Additive website schema and migration | completed | 6 schema failures; 2 isolation regressions | 36/36 DB/schema pass, zero skip; reviews PASS | 589d36e |
| 3 | Opaque website session ownership | completed | missing module; secure-cookie and activity regressions | 15/15 pass, DB 5/5 zero skip; reviews PASS | 514c2d9 |
| 4 | Website adapter and safe product context | completed | 4 initial review regressions; 7 second-review boundary failures | 129/129 related pass; TypeScript, ESLint, db:check, security regression and independent reviews PASS | 663d894 |
| 5 | Public request validation and idempotent ingest | completed | missing public helper/route modules | 38/38 focused pass, DB zero skip; TypeScript, ESLint and diff check PASS | ec191e3 |
| 6 | Public rate limits and website cost reservations | completed | missing module/API 429/bucket-budget boundaries; concurrent duplicate double-count | 820/820 customer-service pass, repository DB 85/85 plus concurrent duplicate regression, clean migration PASS; reviews complete | 7feb034 + follow-up amend |
| 7 | Website policy acknowledgements and review incidents | completed | 3 original failures; Fix Round 1 controlled mutations proved review reuse, attempt isolation, settled recovery, and cancellation guards | Fix Round 1 focused 14/14; serial full Customer Service 812/812 zero skip; typecheck/db:check/no-send PASS | 9c6673f |
| 8 | Validator-gated website publication | completed | Original 5 failures; Fix Round 1 race/proof/attempt/session failures; Fix Round 2 proved stale pre-provider time allowed publication after session expiry | Fix Round 2 runner 26/26, expiry DB 1/1, focused publication/recovery/no-send/security 37/37; typecheck/diff/no-send PASS; prior controller full Customer Service 831/831 zero skip remains the Task 8 baseline | amended Task 8 commit |
| 9 | Website conversation context and learning boundary | completed | Original: Website committed replies missing; Website human outbound auto-created Case Memory. Fix Round 1: causal ordering/truncation, cross-channel predicate, repository-direct Website Case Memory exclusion, Website approved-only retrieval coverage | Fix Round 1 focused DB 6/6; serial full Customer Service 838/838 zero skip; final conversation eval 18/18 and learning eval 50 cases with leakage/bypass/violation/auto-send 0; typecheck/db:check/diff/no-send PASS | amended Task 9 commit |
| 10 | Deduplicated review email outbox | completed | Missing service/Cron/email validation; privacy and expiry race regressions | Serial Customer Service 846/846 zero skip; fix DB 124/124; focused final 82; typecheck/db:check/no-send PASS; independent re-review Critical/Important/Minor 0 | 0a238f2 + 6ff7734 + 8287575 |
| 11 | Session-scoped incremental public updates | completed | Missing reader/route/repository; generic error; microsecond cursor duplication; index-plan and recovery-label regressions | Focused 20; serial full 857/857; typecheck/lint/db:check/no-send PASS; re-review Critical/Important 0 | 867ac92 + 613a8ec |
| 12 | Public chat widget | completed | Missing widget/chrome mount; duplicate rendering; stale retry payload; route exclusions; Shift+Enter proof | Relevant 82/82 including no-send/security; typecheck/lint/diff PASS; re-review Critical/Important/Minor 0; browser smoke deferred to Staging | 3f9b401 + 0e38f80 |
| 13 | Unified admin inbox and manual website reply | completed | Original UI/API gaps; six focused review rounds proved lock ordering, opaque selector integrity/renewal/indexing, deep-link pinning, alert linearization/recovery, provider idempotency horizon, immutable payload and provider-scope binding | Final independent review APPROVED; focused 104/104, provider-scope DB 2/2, repository DB 143/143, schema/session/public DB 47/47; typecheck/lint/db:check/migration replay/no-send PASS | 57870a2 + 0780028 + 641f83b + b09cd01 + 1d60b38 + c9f70f2 + bff544a |
| 14 | Public security and prompt-injection regression | completed with approved structured-output amendment and review fixes | Original adversarial regression plus amendment; review RED proved unsupported schema keywords, duplicate-key collapse, discarded renderer proof, proof-less/mixed publication, incomplete quote fields, and cross-product publication when authoritative message context was omitted | Final focused 226/226; parent Customer Service 993 non-integration pass; fresh migrated DB 167/167 zero skip with 0051 ledger; type/lint/db:check/privacy/no-send PASS | 15f62df + 261e504 + final product-context fix |
| 15 | Metrics, retention, and evaluation | completed | RED proved missing channel metrics/filtering, NO_REPLY telemetry, retention route/schema/CAS, 120-case evaluator, real rate-block telemetry, exact retention boundaries, and residual attempt/feedback text | Final focused GREEN; fresh migration replay 53 rows/hash match; full serial Customer Service + DB 1169/1169 zero skip; type/lint/db:check/privacy/secret/no-send PASS | Task 15 commit |
| 16 | Staging integration and release evidence | pending | pending | pending | pending |

## Task 10 review rulings

- Fix Round 1: email privacy must be fail-closed; expired deep links must not be delivered; stale lease settlement and best-effort delivery isolation need direct tests.
- Ruling: keep the one-minute secured Cron entry because Task 10 explicitly mandates it and this worktree is not deployed to Production. Production remains untouched until a separate rollout approval.
- Ruling: authenticated admin deep-link resolution belongs to Task 13, which owns the protected inbox selection flow. Task 10 must generate/hash/expire tokens and must never send an expired link.
- Fix Round 2: added a fresh pre-provider expiry check and terminal CAS settlement; scoped re-review APPROVED with no findings.
- Task 11 ruling: rate limiting remains a transient POST result and is not reconstructed from buckets by GET polling.
- Task 11 Minor: plan tests force `enable_seqscan=off`, proving index eligibility rather than default planner choice; bounded queries and indexes remain verified.

## Load-bearing invariants

- Website public replies require Policy Gate, strict allowlisted structured provider output, persisted canonical decision plus template version, authoritative persisted message product context, exact publication-time re-rendering, and Output Validator PASS.
- HIGH RISK, UNRESOLVED, and REALTIME_REQUIRED are blocked before OpenAI.
- Website human replies require an explicit admin/staff action and cannot target Facebook.
- Facebook production behavior, Meta callback, Payment Requests, and Messenger no-send stay unchanged.
- One unresolved review generation creates at most one email alert.
- Cross-session leakage, policy bypass, and automatic business actions remain zero.
