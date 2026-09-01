# Task 4B — Reply Assistant read purity and feedback reliability

## Status

- Commit: `34ddd14e1263fdf628e7831b301539d614cfdd03` (`fix(reply-assistant): keep reads pure and feedback idempotent`)
- Production/Vercel/database migration/environment changes: none.
- Production customer records and real replies: untouched.

## Root causes fixed

1. `/reply-assistant` performed `recoverDueHumanReplies` and `refreshLearningCandidates` during a permissioned page render.  `loadQueuePage` also upserted website-review selector rows, so initial renders, queue GETs, live-update GETs, and deep-link resolution could write data.
2. Draft-feedback clicks generated a new idempotency key for every click and had no in-flight guard or visible error path.  A rapid second click produced a second valid feedback row; failed POST and clipboard operations could reject invisibly.
3. The dedicated Test DB run exposed two integration-fixture defects in the selector follow-up: the bounded-maintenance case created two concurrent active website pilots, and persisted selectors could only be reconstructed with the current secret.  A rotation/recovery workflow that explicitly retains the prior secret therefore lost an otherwise valid dedicated review link.

## Implemented changes

- Removed render-time recovery/learning writes from `src/app/reply-assistant/page.tsx`.
- Kept selector creation inside `openWebsiteHumanReview`'s existing transaction; queue/live/deep-link readers now only query and verify persisted selector hashes.
- Added bounded, insert-only `refreshOpenWebsiteReviewSelectors` maintenance and runs it, recovery, and learning refresh through the existing bearer-authenticated turn-recovery worker after its bounded turn batch.
- Retained selector hash lookup, expiry validation, HMAC verification, and secret-rotation fail-closed behavior.  An open review missing a valid persisted selector remains visible but cannot send a reply.
- The repository can now accept one explicitly supplied previous selector secret only for reconstructing and validating an already-persisted, unexpired selector.  Issuance and protected maintenance use the current secret only.  Normal runtime construction supplies no previous secret and consequently remains fail-closed; enabling a Production overlap requires a separately approved configuration rollout.
- Made the selector-maintenance integration fixture hermetic by sharing one active website pilot across its two seeded reviews rather than weakening the one-active-pilot database constraint.
- Added per-attempt/action feedback in-flight locking, stable retry idempotency keys, accessible errors, clipboard error handling, and terminal-outcome disabling.

## TDD evidence

### RED observed before implementation

- Page-render test showed `recoverDueHumanReplies` was called once.
- Authorized zero-turn worker test showed maintenance was called zero times.
- Selector reconstruction test failed because no stored-expiry constructor existed.
- Feedback tests proved two POSTs on a deferred double-click, no alert after failed feedback/clipboard, and a completed accept action remained enabled.

### GREEN verification

```text
npm run test:run -- [19 focused Reply Assistant route/component/page/selector/worker files]
```

Result: **19 files passed, 93 tests passed**.

Follow-up P3 regression coverage:

```text
npm run test:run -- src/components/reply-assistant/reply-assistant-client.test.tsx
```

Result: **1 file passed, 25 tests passed**.  The new direct case proves that a successful clipboard write followed by a failed `copied` feedback POST presents the copy-specific accessible warning and reuses the same copied-event idempotency key on retry.  No production source change was required.

Follow-up red/green evidence after the guarded Test DB reported **166 passed / 3 failed**:

```text
npm run typecheck
npm run test:run -- src/server/customer-service/website/review-selector.test.ts src/app/reply-assistant/page.test.tsx src/app/api/internal/reply-assistant/turn-recovery/route-handler.test.ts src/components/reply-assistant/reply-assistant-client.test.tsx src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts
```

Result: typecheck passed.  The focused unit set passed **39 tests**; the integration file was safely skipped locally because its dedicated Test DB gate was not configured.  The new integration scenarios are: one shared active pilot for multi-review selector maintenance; old links resolve only when `previousReviewSelectorSecret` is explicitly passed; the pre-existing unconfigured-secret test remains fail-closed.  Parent acceptance will rerun the guarded 169-test DB suite.

```text
npm run lint -- src/server/customer-service/repositories/drizzle-customer-service-repository.ts src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts
git diff --check
```

Result: exit 0.  ESLint reports two pre-existing unused mock-parameter warnings in the integration file; no errors were reported.

```text
npm run test:run -- src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts
```

Result: **169 tests skipped** because `TEST_DATABASE_URL` is not configured; no database fallback or Production connection was used.

```text
npx eslint [changed Reply Assistant source and unit-test files]
git diff --cached --check
```

Result: passed.

`npm run typecheck -- --pretty false` was attempted before commit but is currently blocked by concurrent, unstaged customer-chat work outside this commit: `src/app/api/customer-chat/messages/route-handler.ts`, its route test, and `src/server/customer-service/website/security-regression.test.ts` report the missing/incompatible `createSessionToken` contract.  The full Vitest run was likewise blocked only in the parallel customer-chat/security paths (15 customer-chat component failures and 3 security-regression failures); the focused Reply Assistant suite above is green.

## Residual risks

- Existing open website reviews without a selector must be seeded by the protected worker.  Until then, the review is shown without a send action; this intentionally fails closed.
- Same-window selector secret rotation also fails closed until the next selector window permits insert-only worker issuance.  No GET replaces a stored selector hash.
- The Test DB integration assertions are committed but not executed in this environment because no dedicated `TEST_DATABASE_URL` was available.
- This follow-up intentionally does not add or mutate a Production environment variable.  Runtime has no configured prior selector/session secret today, so it remains fail-closed until a separately approved overlap rollout supplies one.
