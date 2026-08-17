# Task 9 Report: Safe Image Status in Human Review

## Status

Complete. The accompanying Task 9 commit contains this report.

## Scope Delivered

- Extended the server-to-browser queue DTO with only `attachmentCount`, `imageAnalysisStatus`, and `imageAssessmentSummary`.
- Derived image assessments only from an analyzed attempt whose attachment set matches and whose temporary inputs were deleted, then re-validated the stored analysis schema before exposing its safe summary.
- Classified attachment-bearing messages without a reusable validated assessment as `human_review_required`; text-only messages remain `not_applicable`.
- Added the human-review assessment panel without previews, download controls, remote URLs, storage keys, hashes, attachment IDs, or conversation/sender identifiers.
- Kept image-only and blocked visual states in human review. Generate and Regenerate are disabled as applicable; existing manual acceptance, Copy, and manual-send controls remain available for an existing draft.
- Added containment and wrapping rules for 390px mobile layouts: queue cards, assessment text, buttons, and textarea have stable minimum/maximum widths and wrapping.

## Test-First Evidence

Before production changes, ran:

```bash
npm run test:run -- src/components/reply-assistant/reply-assistant-client.test.tsx src/app/api/reply-assistant/messages/route.test.ts
```

Result: expected RED state. Three new component tests failed because the existing UI did not render `Image assessment`, did not expose a disabled Generate control for image-only review, and did not mark or disable regeneration for a visual review requirement.

## Verification

Passed:

```bash
npm run test:run -- src/components/reply-assistant/reply-assistant-client.test.tsx src/app/api/reply-assistant/messages/route.test.ts
# 2 files, 8 tests passed

npm run typecheck

git diff --check
```

`npm run lint` exited successfully with three pre-existing warnings in `mock-provider.ts` and `openai-responses.test.ts`; Task 9 introduced no lint errors.

## Browser Validation

Incomplete. Started `npm run dev -- -H 0.0.0.0 -p 3001` and requested `http://192.168.4.199:3001/reply-assistant`, but this worktree lacks the required local `BETTER_AUTH_URL` configuration. The route failed before authentication or UI rendering, so an authenticated 390x844 screenshot and live no-overflow/manual-control verification could not be completed in this agent environment.

## Boundaries and Residual Risk

- No policy, provider, send, Production, callback, or Website Chat code changed.
- Queue projection read count is bounded, while the number of historical analyzed-attempt rows returned remains data-dependent so the latest valid historical assessment can be selected without weakening cleanup or schema validation.
- Live authenticated 390px review remains the only outstanding validation.

## Fix Round 1

### Server Enforcement

- `CustomerServiceEngine` now resolves image context after the policy gate regardless of whether image analysis is enabled.
- A selected attachment context without a validated reusable manual-regeneration summary records `image_review_required` with `image_analysis_unavailable` when no processor exists. This covers authenticated direct Generate and Regenerate calls without relying on disabled browser controls.
- Text-only generation retains the Phase 3.3 path. Policy rejection remains before image-context lookup, and the disabled-image guard calls neither image nor text providers.

### Batched Queue Projection

- `listQueue` now reads queue attachments, analyzed image attempts, and their cleanup inputs in set-based batches for the selected queue message IDs.
- Exact attachment membership, analyzed status, deleted cleanup proof, and strict schema parsing still run before an assessment is exposed. The first valid historical assessment is selected per message; malformed or cleanup-incomplete attempts remain human-review-only.
- A queue request with attachment-bearing items uses no more than four reads: queue rows, attachments, analyzed attempts, and attempt inputs. Attempt-history row volume remains data-dependent, but no per-message or per-attempt query chain remains.

### Fix-Round Verification

Test-first RED run:

```bash
npm run test:run -- src/server/customer-service/engine.test.ts src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts
# 2 expected engine failures before the server guard: disabled text-only path skipped image-context lookup; disabled attachment context reached text generation.
```

Passed with an isolated temporary PostgreSQL container, migrated locally without logging credentials:

```bash
DATABASE_URL=<isolated-test-db> npm run db:migrate
DATABASE_URL=<distinct-app-db> TEST_DATABASE_URL=<isolated-test-db> \
npm run test:run -- src/server/customer-service/engine.test.ts src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts
# 30 tests passed, including the four-read queue projection regression.
```

Passed in the normal environment:

```bash
npm run test:run -- src/server/customer-service/engine.test.ts src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts src/components/reply-assistant/reply-assistant-client.test.tsx src/app/api/reply-assistant/messages/route.test.ts src/app/api/reply-assistant/messages/[messageId]/generate/route.test.ts
# 26 passed, 14 PostgreSQL integration tests skipped because no dedicated test database is configured.

npm run typecheck
git diff --check
```

`npm run lint` completed with the same three existing warnings outside Task 9 and no lint errors.
