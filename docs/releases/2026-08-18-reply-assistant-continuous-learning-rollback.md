# Phase 3.6 Rollout and Rollback Plan

## Authority Boundary

This is a plan only. It does not authorize Production deployment, migration, callback changes or feature enablement. Phase 3.5 must be deployed and stable first.

## Rollout Order

1. Complete isolated DB, unit, integration, privacy and real Test Page validation.
2. Deploy additive schema and code dark with continuous-learning feature flag disabled.
3. Verify existing Reply Assistant, storefront, auth, database and no-send behavior.
4. Enable outbound capture only; keep case retrieval and learning UI disabled.
5. Verify signed Production echo capture, redaction, dedupe, zero provider recursion and conversation timeline.
6. Enable matching and metrics; keep case retrieval disabled.
7. After reviewed evidence, enable admin learning review and approved Case Memory retrieval for a limited pilot.
8. Do not change the Meta callback as part of Phase 3.6; it already points to the Production webhook.

Use separate flags so rollback can disable retrieval/learning while retaining safe conversation capture:

- `REPLY_ASSISTANT_HUMAN_ECHO_CAPTURE_ENABLED`;
- `REPLY_ASSISTANT_CASE_MEMORY_ENABLED`;
- `REPLY_ASSISTANT_LEARNING_REVIEW_ENABLED`.

All flags are server-only and default false.

## Rollback Triggers

Immediately disable Phase 3.6 for any:

- outbound echo triggers a provider call or draft;
- duplicate echo creates duplicate learning data;
- cross-customer text/identifier leakage;
- raw sensitive outbound text persists;
- false-positive turn match in the safety set;
- high-risk/realtime/special-price case enters retrieval;
- case memory changes a gate result;
- automatic send or Page token appears;
- migration/data-integrity issue;
- material Phase 3.5 quality regression.

## Rollback Procedure

1. Disable Case Memory retrieval and learning review flags.
2. If capture itself is unsafe, disable outbound capture.
3. Leave the existing Production Meta callback unchanged.
4. Keep additive tables and sanitized audit rows; do not drop or destructively migrate during the incident.
5. If application behavior remains unsafe, roll back the Vercel deployment to the last known-good Phase 3.5 artifact.
6. Preserve sanitized logs, hashes, reason codes and timestamps for diagnosis.
7. Confirm customer incoming drafting remains human-review only and no-send.
8. Re-run a controlled Test Page incoming message and manual reply.

## Database Rollback Position

The migration is additive. Rollback disables readers/writers through feature flags and deployment rollback. New tables/columns remain unused. No down migration, row deletion, table drop or Production data rewrite is part of incident rollback.

## Operational Evidence

- previous and new deployment IDs;
- migration ID and completion time;
- flag states before/after rollback;
- sanitized echo capture/match counts;
- provider-call count for echoes, required zero;
- case retrieval count after disable, required zero;
- automatic-send count, required zero;
- rollback owner and timestamp.

## Manual Owners

- Rollout owner: `____________________________`
- Privacy reviewer: `____________________________`
- AI quality reviewer: `Ronnie / ____________________________`
- Rollback owner: `____________________________`
- Approval time: `____________________________`

Codex does not sign these fields.
