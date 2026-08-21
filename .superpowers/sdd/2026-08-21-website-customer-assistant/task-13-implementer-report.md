# Task 13 Implementer Report

Base commit: `0e38f80`

## Implemented

- Extended the existing `/reply-assistant` queue DTO and polling path with `Facebook`/`Website` channel badges, committed website assistant/staff timeline entries, website review reason, alert status, and a queue-scoped review selector. Website AI drafts remain internal and are not returned as actionable drafts.
- Added a website-only manual reply editor while leaving the existing Facebook Copy/manual-Meta controls unchanged. Polling preserves unsent website text and disables it if the server review selector changes.
- Added `POST /api/reply-assistant/website-replies`. It requires `use_reply_assistant`, trusted same-origin JSON, and a strict body containing only trimmed safe text plus a server-issued review selector. Conversation, session, message, and PSID fields are rejected.
- Added one repository transaction that locks the website review, inserts one deterministic `human_outbound`, resolves the open review by CAS, cancels applicable open/sealed work, abandons settled stale drafts, prevents alert recovery after resolution, and creates the public website update atomically.
- Added idempotent retry handling: the same selector and same committed text returns success without a second outbound; a different reply against a resolved review is rejected generically.
- Completed the Task 10 deep-link flow. `/reply-assistant` authorizes first, hashes the token server-side, requires an open unexpired website review, and passes only the matching queue selector to the client. The deep-link token, conversation ID, and website session identity are absent from the client DTO.
- Enabled the Reply Assistant inbox when either the Facebook pilot or Website assistant is enabled. No provider, Graph client, Messenger capability, page access token, Production configuration, or deployment was added.

## RED Evidence

- Initial UI/page/API run: 6 intended failures and 19 passes. Missing behavior was channel badges, website timeline/alert/editor, manual send isolation/editor preservation, and deep-link selection.
- The new manual website route suite failed to load because `route-handler.ts` did not exist.
- Initial focused repository run: 3 intended failures with 120 skipped. Website DTO fields/timeline were absent and `answerWebsiteReview` did not exist.
- The alert live-update regression failed after implementation but before migration application because alert settlement produced no queue delta.
- The first full repository GREEN attempt found the Facebook-only queue query count increased from 5 to 6. The review lookup was narrowed to website conversations before the final full rerun.

## GREEN Evidence

- Focused UI/page/API tests: 37/37 passed.
- Focused Reply Assistant/security tests: 62/62 passed.
- Relevant non-database matrix, serial: 68 files and 785/785 tests passed.
- Dedicated database suites, run independently and serially from `../payment-adapters/.env.local`: repository 123/123, website session 5/5, website public updates 5/5. Zero skipped in each completed suite.
- A combined 918-test one-worker run passed 914 and failed four older repository cases due to shared-process database interference. All four exact cases then passed (4/4), and the authoritative independent repository rerun passed 123/123.
- `npm run typecheck`: passed.
- `npm run lint`: exited 0 with zero errors and three pre-existing unused-parameter warnings in mock/OpenAI provider files.
- `npm run db:check` and `git diff --check`: passed.
- `next build`: passed all 108 static-generation steps with explicit local-only placeholder `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, and unreachable placeholder `DATABASE_URL`. The first environment-free attempt stopped at the existing required `BETTER_AUTH_URL` boundary before page collection.
- No browser smoke was claimed. Port 3000 was already owned by the `payment-requests` worktree, and this worktree has no configured local auth/database environment.

## Migration

- Added `drizzle/0049_website_review_live_updates.sql` only.
- It adds deferred UI-change triggers for website human reviews, review-alert outbox changes, and committed website assistant messages so existing polling receives queue-conversation revisions.
- No table, column, index, destructive migration, or Production migration was added or run.

## Bounded Rulings

- The queue selector is the server-issued website human-review UUID. The browser never submits a conversation ID, session identity, message ID, external identity, or PSID; the repository accepts the selector only when it resolves to the website review boundary and applies channel/status CAS checks.
- A resolved selector is generically unavailable except when the same selector and exact committed text are retried. That one case returns idempotent success to satisfy network retry/double-click safety without inserting another outbound.
- Public website timeline entries come only from persisted customer events, committed website assistant messages, and real staff `human_outbound` events. AI attempt drafts remain internal.
