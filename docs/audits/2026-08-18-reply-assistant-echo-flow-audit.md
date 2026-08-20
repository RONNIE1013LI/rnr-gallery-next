# Phase 3.6 Current Echo-Flow Audit

Date: 18 August 2026

## Scope

This is a read-only audit of the current Production deployment, the Phase 3.5 candidate, PostgreSQL schema state, Vercel request logs, and repository fixtures. It does not change Production, Meta configuration, the callback, database data, or sending capability.

## Environment Boundary

| Surface | Observed version | Meaning |
| --- | --- | --- |
| Production deployment | `dpl_BU8K5BiFx21wXJFsmAbwkXrniJjw`, READY | Current `rrgallery.co.nz` deployment inspected read-only. |
| Production release worktree | `8661df013741244143910b37f9f19150447472f1` | Repository release state that still filters echo events. |
| Phase 3.5 candidate | `59b047dab4688cdead2ea683dd214ea7ce92ba43` | Completed candidate with conversation-event and turn support; not present in the Production database. |
| Phase 3.6 worktree | `feat/reply-assistant-continuous-learning` from `59b047d` | Design-only branch. |

The Vercel inspection does not expose a Git source commit, so the deployment-to-commit relationship is supported by the current release worktree and deployed behavior, not by Vercel Git metadata.

## Evidence

### Production request logs

- Vercel returned 50 unique `POST /api/meta/webhook` requests between 12:40:19 and 13:33:25 NZST on 18 August 2026.
- Every observed request returned HTTP 200.
- The request logs intentionally contain no payload or event type.
- Therefore they prove webhook traffic reached Production, but cannot prove whether any request was an outbound echo.

### Production code path

At Production release `8661df0`, `src/server/customer-service/adapters/facebook.ts` rejects any message whose `message.is_echo === true` before normalization. The webhook handler receives an empty normalized list, performs no persistence, schedules no deferred work, and returns 200.

Repository tests explicitly assert:

- echo webhook returns 200;
- repository ingest is not called;
- deferred generation is not scheduled.

### Production database

A read-only transaction against the Production PostgreSQL connection reported:

- `customer_service_messages`: present, 39 rows at audit time;
- `customer_service_ai_attempts`: present;
- `customer_service_conversation_events`: absent;
- `customer_service_turns`: absent.

No raw identifiers or message text were queried. This proves Production has not applied the Phase 3.5 conversation migration and cannot currently store staff outbound history.

### Phase 3.5 candidate

The Phase 3.5 candidate changes the adapter contract:

- customer event conversation key: sender PSID;
- staff echo conversation key: recipient PSID;
- staff echo role: `staff`;
- message ID and conversation key are HMAC-hashed before persistence;
- staff echo is stored in `customer_service_conversation_events` and returns `context_only`;
- staff echo itself schedules no AI work.

The candidate context loader reads role-labelled customer and staff events from the same internal conversation. AI drafts remain in `customer_service_ai_attempts` and are not inserted into conversation history.

## Required First-Audit Answers

| Question | Answer | Direct evidence |
| --- | --- | --- |
| 1. Does outbound echo currently reach the Production webhook? | **UNKNOWN** | Production logs show webhook POST traffic and 200 responses, but no payload/event type. No safe evidence identifies an echo. |
| 2. Where is echo currently filtered? | **Production Facebook adapter** | `message.is_echo === true` causes `continue` before normalization and persistence in release `8661df0`. |
| 3. Is the echo payload sufficient to identify Page, conversation, direction, message ID and timestamp? | **YES in the supported fixture/Meta shape; real Production echo still needs staging proof** | `entry.id` identifies Page; `message.is_echo` identifies direction; `recipient.id` identifies the customer conversation; `message.mid` identifies the event; `event.timestamp`/`entry.time` provides time. |
| 4. Does the current Production database save R&R/staff outbound messages? | **NO** | Conversation-event/turn tables are absent and the adapter filters echo before persistence. |
| 5. Does the Phase 3.5 context builder include actual human outbound history? | **Candidate YES; Production NO** | Candidate stores role `staff` and loads role-labelled same-conversation history. Production lacks both adapter behavior and tables. |
| 6. Where is the missing link? | **Production adapter and undeployed Phase 3.5 migration/code** | Echo is dropped before repository ingest; Production has no conversation-event storage. |

## Additional Phase 3.5 Gap Relevant to Phase 3.6

The Phase 3.5 design says a staff event closes an open customer-turn boundary. The candidate repository currently inserts a staff event and returns `context_only`, but does not suppress an already-open turn. A previously scheduled debounce task could therefore generate a stale draft after Ronnie has already replied. Phase 3.6 must close this race with repository-level/CAS behavior and prove that a staff echo received before generation results in zero provider calls.

## Meta Subscription Gap

The repository runbook asks Meta to subscribe to `messages` and `message_echoes`, but its real Test Page completion record remains pending. Current Production logs cannot prove the active subscription. Staging must verify a real manual Business Suite reply produces a signed echo event before Phase 3.6 can be considered ready.

## Dependency Conclusion

Phase 3.6 may be designed and implemented on top of candidate `59b047d`, but cannot be deployed independently. The Phase 3.5 additive migration and conversation behavior are hard prerequisites. No Production migration or deployment is authorized by this audit.
