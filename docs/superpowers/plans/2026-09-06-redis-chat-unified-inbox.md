# Redis Chat and Unified Inbox Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement and review each task.

**Goal:** Ordinary website chat runs without Neon and website/Meta messages are visible and actionable in the backend.

**Architecture:** Dedicated Redis website runtime preserves existing public contracts; shared Meta index and unified admin facade retain channel-specific delivery safety. Authentication identity is a separately verified prerequisite, not an assumed token decode.

**Tech Stack:** Existing Next.js, TypeScript, Vitest, Redis REST/Lua, AES-GCM and shared R&R AI brain.

**Spec:** docs/superpowers/specs/2026-09-06-redis-chat-unified-inbox-design.md

## Global constraints

- No migrations, historical data writes, new dependencies or weakening of security.
- Production configuration/auth changes require separate approval; main is the only release source.
- Preserve current AI quality and actual delivery truth; no customer-message replay.
- Transcript retention proposed 30 days; public session remains seven days.

## Task 1: Website store and runtime

Files: create src/server/rnr-ai/website/redis-website-repository.ts and tests, website-runtime.ts and tests; adapt public customer-chat route composition only after dependency proof. Reuse existing handler/session/cursor contracts.

Interface: repository exposes resolveWebsiteSession, ingestConversationEvent, listWebsitePublicUpdates, listQueue, loadEarlierInboxTimeline, resolveReplyAssistantInbox, answerWebsiteReview using existing CustomerServiceRepository signatures; runtime exposes repository and processTurn(turnId, generationMode). Public route auth accessor is injected until Task 2.

- [ ] Write failing behavioral tests for repeated same message, concurrent newest-turn publication, human reply race, existing limits and identity mismatch. Example assertion: `expect((await repository.ingestConversationEvent(sameInput)).status).not.toBe('turn_pending')` after initial acceptance, with exactly one stored customer event.
- [ ] Run new test files using `npx --no-install vitest run` and record expected failure.
- [ ] Implement encrypted Redis payloads and atomic mutations, shared-brain generation, bounded recovery and review/manual reply behavior. Do not invoke legacy runtime or notification outbox.
- [ ] Re-run tests plus existing customer-chat handler/security/publication suites; commit scoped files.

## Task 2: Verified no-Neon identity and route wiring

Files: chat-specific identity accessor under src/server/rnr-ai/website, all three customer-chat route composition files, auth configuration only if required and independently gated.

- [ ] Test anonymous, valid authenticated, expired, revoked, login/logout and missing-Redis paths; require correct existing identity precedence, never accept a fabricated user ID.
- [ ] Inspect installed Better Auth source before selecting native secondary storage or trusted identity bridge. Preserve current commerce/admin authentication and document any required activation approval.
- [ ] Wire public routes to Task 1 with local product artifact and no legacy after-tasks. Test `expect(databaseSpy).not.toHaveBeenCalled()` over bootstrap/send/poll and authenticated transition cases, with real adapter logic and only external transport mocked.
- [ ] Commit only verified path; mark activation prerequisite explicitly if outstanding.

## Task 3: Meta index and unified inbox

Files: new src/server/rnr-ai/inbox facade/store/tests; Meta webhook/runtime boundary; reply-assistant page, messages/updates/timeline/takeover/website-replies routes and necessary existing UI controls.

- [ ] Reproduce missing GREEN Meta and Redis website items through list and refresh tests.
- [ ] Index encrypted Meta locator independently of AI eligibility; load Graph history with caps and preserve incomplete status. Use known sent IDs to distinguish AI/staff; no sends during reads.
- [ ] Merge legacy historical and Redis website/Meta rows by stable identity; provide bounded cursor/timeline support and clear metric scope. Route manual website replies into its store and takeover to correct identity.
- [ ] Test permission rejection before Redis/Graph access, refresh after new message, actual sent vs draft, human replies and stale cursors. Commit and review.

## Task 4: Integration and release

- [ ] Exercise full synthetic routes with isolated Redis and database-call traps, both channel inboxes and manual races; run full isolated release suite/typecheck/lint/build.
- [ ] Independently review all integration changes; fix material findings and rerun affected tests.
- [ ] Resolve any separately required configuration approval with concrete tested diff before release.
- [ ] Fetch main, verify Production baseline, release clean branch through main and automatic Vercel deploy; verify SHA/ref/aliases and bounded live public/inbox behavior. Record actual evidence and remaining limitations.
