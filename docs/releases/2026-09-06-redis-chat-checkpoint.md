# Redis chat implementation checkpoint — NOT RELEASE READY

Owner approved website chat Redis migration, unified Meta/website backend data chain, normal deployment after tests, and separately approved native encrypted Redis auth configuration. Production was not changed in this phase.

Baseline Production/main: c877f9a1afc48e383cc2ee844fb48662dde35fa0, READY dpl_HLzYN8gg9wFgUEEpGVE9Rs8S5JZb, verified main ref and official aliases. Feature branch: codex/redis-chat-unified-inbox-20260906.

## Implemented candidate code

- Encrypted Redis website repository/runtime: atomic mutation, session/rate/turn/review/publication scaffolding, review alerts and estimated new-runtime budget ledger. This remains a candidate pending full review and public-route integration.
- Meta locator index and bounded Graph-backed inbox preview/timeline, unified admin read/takeover/manual website reply facade; still needs integrated review.
- Auth candidate 8a83545: encrypted native secondary store, signed-cookie chat reader, token revocation fences and account watermark. auth.ts is NOT activated. Public customer-chat route composition remains the prior Neon path.

## Actual checkpoint verification

2026-09-06 23:03 NZST: 14 test files / 108 tests PASS with all three opt-in Redis integration environment variables pointing only to loopback59487. Suites include auth, Redis website, review alerts/runtime, Meta inbox, Graph context, webhook, takeover and inbox UI.

Typecheck initially found one test Redis responseEncoding mismatch and two callback-mutation narrowing errors. Corrected test responseEncoding to false and terminal-state comparison to array membership. npm run typecheck then PASS. Re-ran the two affected Redis/review-alert suites: 7 tests PASS. git diff --check PASS.

This is NOT a full release test, build, independent review or live acceptance result.

## Interruption and remaining work

Three active subagents (website implementation, Meta inbox implementation, independent auth reviewer) stopped with Codex usage-limit errors. Their source edits have been preserved. The independent auth review did not finish.

1. Read and review every candidate module; finish formatting and any incomplete implementation, especially budgets, session expiry at publication, review alert recovery, bounded Graph hydration and timeline cursors.
2. Integrate full authOptions including deletion hooks into auth.ts under an explicit configured rollout boundary. Preserve existing session seven-day lifetime, DB sessions/verification and rate limits. Existing signed-in customers require fresh login for a native Redis cache entry. Do not warm cache unsafely or downgrade cache misses to anonymous.
3. Switch all three public chat routes to Redis runtime and verified chat identity; replace product-context DB read with approved local metadata, remove legacy post-turn outbox dependency, expose clear signed-session-unavailable errors in UI. Preserve all current validation and public cursor identity isolation.
4. Integrate Redis turn/alert recovery into authenticated internal worker routes; do not lose closed-tab recovery or silently disable existing history maintenance/notifications.
5. Complete admin review-deeplink routing, manual reply/takeover behavior and source/metric scope. Verify no shared item falls into legacy Generate/Send routes.
6. Add integrated real Redis public-route/database-trap tests (anonymous + authenticated + login/logout), existing history isolation, full relevant lint, isolated full release suite/build and independent security review.
7. Only after all gates pass: fetch main, verify Production source, release through main automatic Vercel deployment, verify SHA/ref/aliases, perform bounded authorized actual website/Meta inbox checks. No replay of customer messages.

## Test setup for resume

The root-owned Redis7.4.2 source/binaries are in /tmp/redis-7.4.2; synthetic REST bridge source is /tmp/rnr-chat-redis-rest.mjs. Redis port59486 and REST59487 are loopback-only, no persistence. Start them only after checking ports/ownership. Test token is the synthetic literal synthetic-local-redis-test; this is not a credential for any external service.

Opt-in test variables: RNR_CHAT_AUTH_TEST_REDIS_URL, RNR_INBOX_TEST_REDIS_URL, WEBSITE_TEST_REDIS_URL, all http://127.0.0.1:59487. Root-owned PostgreSQL test container rnr-redis-chat-pg-test-20260906 used tmpfs and loopback59488; remove/recreate only this container for later tests. No Production DB credentials were used for these tests.

## Resumed verification, 2026-09-06 23:30 NZST — still NOT RELEASE READY

- Fetched and rebased unpublished implementation onto main 12c81bbae4c38a5147a2d9ac13044fa4a5a1ee6d, preserving the new canvas size guide. Verified READY Production dpl_BquG36KtgCewKA3hkrvp9MQZXtJE matches that SHA/ref main and required aliases.
- Integrated encrypted native auth with DB-authoritative native session management; ordinary chat identity stays cache-only. Independent rereview passed 31 auth/config tests with real local Redis and two loader tests; prior revoke-other index gap fixed. Native BetterAuth deletion-failure behavior is inherited, so successful native revocation still depends on successful DB deletion.
- Public Redis composition is now wired for bootstrap/send/poll and recovery, including local product context, identity errors and actionable sign-in. Actual-route tests cover real Redis and actual shared brain with only external HTTP stubbed; database/schema and legacy import traps passed. Targeted integration run reported 144 passing tests; initial master-OFF manual test required artificial settlement, and independent review correctly found the missing real manual-review path. That fix and a genuine route-level regression remain in progress.
- Root independently ran 124 inbox/Meta/webhook/admin tests with real Redis; all passed. Root ran changed TypeScript/TSX ESLint and 42 mock-provider shared contract cases; passed. These fixtures do not demonstrate model quality or live delivery.
- Fixed empty Meta preview lazy-history entry and Redis website review deep-link source tagging; 41 targeted tests passed.
- Full isolated database tests/build started on GitHub run 34030228437, commit a02c237; pending. Later budget/manual/UI changes require final-head verification. Feature branch only was pushed; no Production release.
- Read-only Production environment presence check confirms required Redis, encryption, website rollout, Graph and auth keys exist (values not printed). Live runtime readiness still requires post-release acceptance.
- Read-only backend UI currently shows AI mode OFF. User asked whether to restore ON for acceptance; no setting changed. Existing admin login is usable.
