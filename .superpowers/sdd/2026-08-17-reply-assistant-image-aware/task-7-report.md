# Task 7 Report

## Status

Implemented policy-first image orchestration, guaranteed temporary-object cleanup, and an additive visual-claim validator in the Task 7 commit (`feat: gate image-aware reply drafts`).

## TDD Evidence

The orchestration and processor tests were written first. The initial focused run failed because the attachment processor and image-aware engine path did not exist. Prompt and image-validator tests also failed before their optional visual section and separate validator were added.

Repository integration coverage was verified with a dedicated disposable PostgreSQL database. To prove the persistence test was meaningful, the production repository patch was temporarily reversed while the test remained present; the run failed with `repository.createImageAnalysisAttempt is not a function`. Restoring the implementation made all 10 integration tests pass.

Independent review produced three valid regressions, each observed failing before its fix:

- provider usage/cost could be lost if the first terminal persistence write failed;
- an analyzed result could be reused after temporary-object deletion failed;
- definitive claims such as `We can fully restore this photo` and `This photo is ready to print` passed the additive validator.

The processor now preserves returned usage on persistence failure, previous analysis is reusable only after every related object is marked deleted, and the visual validator blocks the additional definitive claim forms.

## Implementation

- Extended internal draft generation with optional ephemeral attachment sources while leaving public generate/regenerate request bodies unchanged and empty.
- Kept the existing policy gate first. High risk, unresolved, realtime-required, and image-only inputs stop before both image and text providers.
- Added attachment processing through the existing source-reader, private-store, image-provider, and repository interfaces.
- Validated selected attachment IDs, source metadata, byte limits, MIME type, and SHA-256 before analysis.
- Reserved image cost against the existing daily and total budget rows before the single provider call, then released the reservation and persisted actual usage/cost on every terminal provider path.
- Persisted exact image-analysis input membership and safe terminal states. Cross-conversation attachment membership is rejected.
- Deleted every temporary object from `finally`; cleanup failures retain the deletion guard, mark the attachment failed, and prevent analysis reuse.
- Reused only validated, assessed, fully cleaned image summaries on manual regeneration without downloading or analyzing again.
- Added the optional `VISUAL ASSESSMENT` prompt section using only the validated safe summary. No image bytes or source URLs enter the text prompt.
- Added a separate image draft validator used only when visual context exists. The existing `output-validator.ts` remains byte-for-byte unchanged.
- Preserved the frozen text-only prompt and provider path.
- Wired the processor conditionally in the existing runtime without changing production configuration, callbacks, retry behavior, or send behavior.

## Security and Scope Review

- Policy-blocked and image-only cases make zero image-provider and text-provider calls.
- Invalid image input, budget denial, provider failure, persistence failure, and cleanup failure make zero text-provider calls.
- The image provider is called at most once; no automatic retry was added.
- Temporary object deletion executes in `finally` for every path after a save.
- Public generate/regenerate handlers, Meta callback code, customer-service configuration, sending code, and production configuration are unchanged.
- `output-validator.ts` has the same pre/post SHA-256: `3e95c2af99e18b91cbaa8351df5c3907aa64066fbf21ee795c262a5852581a76`.
- Repository/type changes are limited to the image-attempt persistence required by Task 7; no parallel storage or provider abstraction was introduced.

## Verification

- Required orchestration command: 5 files passed, 35 tests passed.
- Attachment processor and security/route regression command: 5 files passed, 16 tests passed.
- PostgreSQL repository integration: 1 file passed, 10 tests passed.
- `npm run typecheck`: passed.
- Targeted ESLint across all 13 changed TypeScript files: passed with zero warnings or errors.
- `git diff --check`: passed.
- Scoped diff audit confirmed zero changes to the existing output validator, public request handlers, customer-service config, and Meta webhook handler.

## Independent Review

Two earlier persistence/cleanup findings and the additive-validator coverage finding were fixed with failing regressions first. Two webhook/source-recovery suggestions were not applied because Task 7 explicitly keeps source context ephemeral and forbids callback changes; Task 8 owns the DB-first Meta handoff that closes over normalized attachment references.

## Concerns

No Task 7 blocker remains. The production Meta webhook will not supply ephemeral attachment sources until Task 8 is implemented, by design. No live OpenAI request was made; provider behavior remains covered at the existing controlled boundary.

## Fix Round 1

### Status

Addressed all four findings from `task-7-review.md` in the scoped fix commit (`fix: bind image attempts to sources and cleanup`).

### TDD Evidence

- The substituted-source integration test first resolved and created an attempt for the wrong ephemeral identity. It now rejects `customer_service_image_context_mismatch` before source read.
- The overlapping-attempt test first allowed one successful shared-row cleanup to certify another attempt whose object deletion failed. It now keeps each key and cleanup result isolated on its exact attempt input.
- A stale failed-cleanup write first downgraded an already deleted exact attempt/key. Deletion proof is now monotonic and the regression passes.
- The second identical reservation first threw `customer_service_image_attempt_not_pending`; the second completion also was not idempotent. Both ambiguous retry paths now return safely without double reserve, release, or spend.
- Five definitive claim forms, including all review examples, first passed the additive validator. They are now blocked while advisory print/restoration language remains accepted.
- A missing HMAC secret first allowed processor construction. The processor now fails startup with `image_source_identity_secret_required`.

### Changes

- HMAC-SHA-256 binds each ephemeral `externalAttachmentKey` to the selected persisted attachment hash before any source read. Attempt creation verifies attachment ID, conversation, ordinal, and source hash atomically.
- Added migration `0024_shocking_silver_surfer.sql`. It preserves existing rows, backfills the new source hash from the restrictive attachment relation, and adds only new columns, checks, and an index.
- Moved active object key/hash, retention deadline, verified metadata, failure state, and deletion proof to `customer_service_image_analysis_inputs`, keyed by exact attempt and attachment.
- Storage and cleanup writes lock the exact attempt input and require the exact storage key. Successful deletion is monotonic; failed deletion retains the raw private key and due date for cleanup.
- Reuse now requires the exact analyzed attempt's complete input set to have attempt-owned `cleanup_status = 'deleted'`.
- Persisted reservation amount and daily scope on the image attempt in the same transaction that updates shared budgets.
- Reservation retries return the existing reservation only when amount and scope match. Completion locks the attempt, releases its persisted reservation, zeroes it, records spend once, and treats terminal retries as no-ops.
- Removed caller-supplied reservation amount/scope from image completion so callers cannot under-release or over-release shared budgets.
- Expanded only the additive image validator; `output-validator.ts` remains unchanged.

### Verification

- Orchestration, processor, prompt, existing validator, additive validator, and policy suite: 6 files passed, 50 tests passed.
- Public-route, no-send, security, serverless, and Meta regressions: 6 files passed, 16 tests passed.
- Isolated PostgreSQL repository plus schema contract: 2 files passed, 24 tests passed.
- `npm run typecheck`: passed.
- Targeted ESLint across all changed TypeScript files: passed with zero warnings or errors.
- `npm run db:check`: passed.
- Migration `0024` applied successfully to the dedicated disposable PostgreSQL database without exposing credentials.

### Scope and Invariants

- Policy-first order, zero provider calls for blocked/image-only paths, no automatic retry, and `finally` cleanup remain unchanged.
- Public generate/regenerate bodies, send behavior, Meta callback, production configuration, and customer-service config are unchanged.
- Text-only prompt behavior remains frozen.
- `output-validator.ts` SHA-256 remains `3e95c2af99e18b91cbaa8351df5c3907aa64066fbf21ee795c262a5852581a76`.

### Concerns

Historical pre-migration image attempts intentionally receive no attempt-owned deletion proof and are therefore not reusable. Backfilling `deleted` from the old shared attachment row would recreate the reviewed concurrency vulnerability; affected manual regenerations fail closed until a new safe analysis is available. Task 8 remains responsible for the ephemeral Meta handoff. No live OpenAI request was made.

## Fix Round 2

### Status

Addressed both remaining findings from the scoped Task 7 re-review in the fix-round-2 commit (`fix: guard legacy image migration state`).

### TDD Evidence

- Six exact advisory/negated assessment sentences first returned additive validator blocks, including `We need to assess whether this photo can be fully restored.` and the equivalent print-assessment form.
- Two `whether ... depends on ...` conditional assessment cases first returned blocks.
- An introductory negated clause first suppressed a later definitive print claim. Comma and contrast boundaries now isolate the clauses, and the later claim remains blocked.
- Independent review found the same suppression when clauses were joined with `and`; the exact regression first passed incorrectly and now blocks the later definitive assertion.
- The migration contract first failed because `0024` had no legacy `provider_pending` precondition before its first schema change.
- Against a disposable database stopped at migration `0023`, `0024` first aborted with `customer_service_legacy_provider_pending_image_attempts`; zero new reservation columns were added and both aggregate reservations remained untouched. After explicitly draining the fixture and zeroing its test reservations, the same migration succeeded.

### Changes

- The additive visual validator now evaluates sentence clauses and exempts only questions, explicit assessment deferrals, withheld confirmations/guarantees, and `whether ... depends on ...` conditions.
- Prior definitive restoration and print examples remain blocked, including a definitive claim after a negated contrast clause.
- Migration `0024` now executes a fail-closed `provider_pending` image-attempt guard before any `ALTER TABLE` statement.
- The migration does not infer, backfill, decrement, or otherwise invent a legacy reservation amount or daily scope.

### Migration Behavior

If any legacy image attempt is still `provider_pending`, migration `0024` aborts before changing the schema with `customer_service_legacy_provider_pending_image_attempts`. Operators must reconcile the in-flight attempt and its shared daily/total reservation under the pre-migration system, then rerun the migration. This is the safe transition because image analysis has not been Production-enabled and the old schema cannot prove ownership of an aggregate reservation.

### Verification

- Additive image validator: 29 tests passed.
- Isolated PostgreSQL repository and schema contract: 2 files passed, 25 tests passed.
- Disposable pre-`0024` migration guard: abort-before-change and post-reconciliation success both verified without printing credentials.
- Full focused orchestration/policy/public-route/no-send checks, typecheck, scoped ESLint, Drizzle consistency, diff checks, and unchanged-validator hash were rerun before commit.

### Concerns

The migration intentionally requires manual reconciliation if a legacy image attempt is `provider_pending`; it cannot safely infer ownership from aggregate budget rows. No Production or send behavior changed, and no live OpenAI request was made.
