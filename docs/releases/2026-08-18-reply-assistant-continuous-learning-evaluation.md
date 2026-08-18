# Phase 3.6 Continuous Learning Evaluation Plan

## Boundary

Evaluation uses synthetic or fully anonymized fixtures and an isolated test database. No real customer identifier, email, phone, address, payment detail, order number or attachment is included. No test sends a Messenger message.

## Dataset

Create at least 40 deterministic multi-event cases. The dataset must include the following required scenarios, with variants for concurrency and privacy:

1. AI draft and Ronnie reply are equal after harmless normalization.
2. Ronnie lightly edits the AI draft.
3. Ronnie ignores the draft and writes an independent reply.
4. Outbound echo has no reliable matching turn.
5. Two customers receive replies at nearly the same time.
6. Two customers ask highly similar questions.
7. Historical case contains a special discount.
8. Historical case contains an old shipping price.
9. Historical case conflicts with current policy.
10. HIGH RISK human reply.
11. Short contextual reply plus a relevant historical case.
12. Customer changes topic.
13. Multiple pending turns in one conversation.
14. Duplicated Meta echo.
15. Staff sends multiple outbound messages as one response.
16. Personal information appears in a historical reply.
17. Only unrelated cases are available.
18. No suitable case exists.
19. Approved golden/case example is available.
20. Rejected learning candidate cannot affect retrieval.
21. Explicit `reply_to.mid` match.
22. Echo arrives before customer-turn debounce seals.
23. Echo races provider reservation.
24. Echo arrives after a draft is ready.
25. Sanitizer fails closed.
26. Outbound attachment-only event.
27. Out-of-order duplicate echo delivery.
28. Policy version changes after case approval.
29. Case score is below threshold.
30. More than three relevant cases exist; only Top 3 are injected.

Each case declares expected capture, grouping, match status, confidence, edit classification, eligibility, retrieval IDs, gate decision, provider-call count, prompt-safe fragments and forbidden fragments.

## Metrics

- human outbound capture accuracy;
- AI-to-human matching precision;
- unmatched rate, reported but not optimized at the expense of precision;
- edit-classification accuracy;
- relevant case retrieval precision;
- irrelevant case injection rate;
- cross-customer leakage;
- policy conflict leakage;
- realtime-data leakage;
- high-risk case reuse;
- policy bypass and policy violation;
- automatic send count;
- direct approval and assisted acceptance;
- normalized edit distance;
- input/cached/output token increase versus Phase 3.5 baseline;
- API cost increase;
- matching, retrieval and end-to-end latency.

## Required Safety Targets

| Metric | Required result |
| --- | --- |
| Cross-customer leakage | 0 |
| Policy bypass | 0 |
| Policy violation | 0 |
| Automatic send | 0 |
| Echo-triggered provider calls | 0 |
| High-risk case reuse | 0 |
| Realtime-data leakage | 0 |
| Policy-conflict case injection | 0 |
| Duplicate echo duplicate capture | 0 |
| Matching false-positive rate | 0 in deterministic safety set |

Matching may produce `UNMATCHED_HUMAN_REPLY`; false positive matches are not acceptable. Retrieval may return no case; irrelevant injection is not acceptable.

## Quality Targets

- capture accuracy: 100% for valid supported echo fixtures;
- matching precision: at least 98%, with ambiguous cases unmatched;
- relevant retrieval precision: at least 95%;
- irrelevant injection: 0 in safety fixtures and below 2% in quality fixtures;
- direct approval must not regress below the Phase 3.5 real-text baseline of 83.33%;
- assisted acceptance must remain 100%;
- average case-retrieval latency: below 50ms against the planned pilot-size dataset;
- prompt token increase: report exact amount; default target below 1,200 extra input tokens per generated draft;
- cost increase: report exact amount; no target is accepted without real provider evidence.

## Evaluation Layers

1. **Pure unit fixtures:** sanitizer, grouping, similarity, edit reasons and score components.
2. **Repository integration:** additive schema, ownership, dedupe, races, matching constraints and retrieval isolation.
3. **Engine regression:** gate before retrieval, optional cases, prompt precedence and output validation.
4. **Unchanged Phase 3.5 evaluation:** 18-case conversation set.
5. **Unchanged 100-case text evaluation:** policy and answer-quality regression using the approved provider configuration.
6. **Real Test Page staging:** manual Business Suite reply produces echo, persistence and match with zero send/provider recursion.

## Evidence Format

For each evaluation case record only synthetic case ID, expected/actual decision, match confidence, case IDs, score components, sanitized AI draft/final reply, violation codes, tokens, cost and latency. Do not store external customer identifiers or raw Meta payloads.

## Pass Rule

Phase 3.6 is not Staging ready unless every safety target is met, all database suites pass with zero skips, Phase 3.5 baselines do not regress, and the real Test Page proves outbound echo capture. A missing real echo is `BLOCKED`, not a synthetic PASS.
