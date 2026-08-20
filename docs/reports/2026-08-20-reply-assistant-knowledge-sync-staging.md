# Reply Assistant Knowledge Sync Staging Report

Date: 2026-08-20

Status: **NOT READY**

## Migration Summary

- Legacy knowledge files audited: 14.
- Legacy files already represented in the candidate: 14.
- Governed historical examples classified: 20.
- Approved reusable historical examples compiled: 8.
- Evidence-only examples excluded: 7.
- High-risk examples excluded: 5.
- Outdated examples: 0. Ronnie confirmed prices have not changed during the last month.
- Policy conflicts promoted into official knowledge: 0.
- Golden Replies: 20.
- Legacy approved Case Memories imported: 0.
- Knowledge version: `894aa90cd6e228d303bfb55fd15de5e7525014432e47786bf85e3921a6705b92`.

Prices and other mutable operational values remain `REALTIME_REQUIRED` regardless of recent price stability.

## Validation

| Check | Result |
| --- | --- |
| Knowledge compiler and check | PASS |
| Customer Service focused/full tests | PASS — 734/734 |
| Independent DB migrations | PASS — additive migrations applied |
| Customer Service DB suites | PASS — 87/87, 0 skipped |
| Phase 3.5 conversation evaluation | PASS — context 100%, short replies 100%, leakage 0, bypass 0 |
| Phase 3.6 learning evaluation | PASS — retrieval precision 100%, irrelevant injection 0, leakage 0, bypass 0, auto-send 0 |
| TypeScript | PASS |
| ESLint | PASS with 0 errors and 3 pre-existing warnings |
| Production build | PASS with required local test environment |
| Security/secret scan | PASS |
| No-send regression | PASS |
| Real 100-case OpenAI evaluation | FAIL — both Preview and Production configured keys returned HTTP 401 before token use |
| Preview `/reply-assistant` | Pending deployment validation |
| 390px UI | Pending Preview validation |

## OpenAI Evaluation Evidence

- Cases: 100.
- Gate matches: 100.
- API-preblocked: 40.
- Attempted provider calls: 60.
- Successful provider calls: 0.
- Provider errors: 60 (`openai_http_401`).
- Policy bypass / violation: 0 / 0.
- Tokens and cost: 0 because authentication failed before model execution.

No OpenAI credential was logged, committed, persisted in the report, or copied into the worktree.

## Blocking Condition

A valid server-side Staging/Preview `OPENAI_API_KEY` is required before the unchanged real 100-case evaluation can measure quality or allow Staging READY. No Production configuration was modified.
